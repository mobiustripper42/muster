/**
 * Start a departure checkout (Phase 12.1a, DEC-109 amended) — the virtual-model
 * replacement for `createBookingCheckout` (seeded-`Event`, 11.2). The customer picks
 * **offering + date + time + guest count**; this acquires a 15-min hold on a fitting boat
 * (fit-and-fallback), prices the held slot exactly as the deriver displayed it, and opens a
 * hosted Checkout carrying the SLOT in metadata (there is no `Event` row yet — the webhook
 * materializes it under the mutex, `writeSlotBooking`).
 *
 * **Writes no reservation.** The hold is the only pre-payment write; the reservation +
 * Payment land in the webhook. The hold makes the common case collision-free — the second
 * buyer sees the slot held and never starts (DEC-109).
 */
import type { OfferingId } from "../domain/ids.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { resolveBasePrice, slotIdentity } from "./availability.js";
import { acquireDepartureHold } from "./claim.js";
import { chargeNowCents, taxCentsFor } from "./payment-config.js";
import { composeFare, effectiveIncludedGuests } from "./pricing.js";

export interface DepartureCheckoutRequest {
  offeringId: OfferingId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock "HH:MM". */
  time: string;
  guestCount: number;
  customerName: string;
  email?: string;
  phone?: string;
  /** Liability-waiver consent (DEC-110) — REQUIRED: no consent, no hold, no charge. */
  waiverConsentAt?: string;
  waiverVersion?: string;
}

export type DepartureCheckoutStart =
  | { ok: true; url: string; sessionId: string }
  | {
      ok: false;
      reason:
        | "offering_missing"
        | "not_live"
        | "invalid_guest_count"
        | "sold_out"
        | "waiver_required";
    };

export async function createDepartureCheckout(
  repo: Repository,
  payments: PaymentPort,
  req: DepartureCheckoutRequest,
  urls: { successUrl: string; cancelUrl: string },
  now: () => string,
): Promise<DepartureCheckoutStart> {
  // Waiver is a hard gate (DEC-110) — check BEFORE acquiring a hold, so a consent-less
  // attempt never parks a hold on a boat.
  if (!req.waiverConsentAt || !req.waiverVersion) {
    return { ok: false, reason: "waiver_required" };
  }

  const held = await acquireDepartureHold(
    repo,
    {
      offeringId: req.offeringId,
      date: req.date,
      time: req.time,
      guestCount: req.guestCount,
    },
    now,
  );
  if ("unbookable" in held) {
    return {
      ok: false,
      reason:
        held.unbookable === "offering_missing"
          ? "offering_missing"
          : held.unbookable === "not_live"
            ? "not_live"
            : "invalid_guest_count",
    };
  }
  if ("soldOut" in held) return { ok: false, reason: "sold_out" };

  const hold = held.held;
  const offering = await repo.getOffering(req.offeringId); // non-null (acquire verified it)
  // Price the held slot exactly as displayed: an override Event's price wins, else the
  // first-match variation off the base (DEC-125). Offering is always priced (basePriceCents).
  const events = await repo.listEvents();
  const key = slotIdentity(hold.vesselId, hold.date, hold.time);
  const slotEvent = events.find(
    (e) =>
      e.source === "muster" &&
      e.status === "scheduled" &&
      slotIdentity(e.vesselId, e.date, e.time) === key,
  );
  const priceCents = slotEvent?.price ?? resolveBasePrice(offering!, hold.date);

  // Compose the party fare (DEC-112 / DEC-125 build note, 12.2): base + extra-guests ×
  // extraGuestPrice. `priceCents` is the per-departure BASE (→ Event.price, frozen); the FARE
  // is what we charge. Tax is on the fare, not the base. The vessel is guaranteed non-null —
  // the hold assigned a real, fitting boat (`candidateVessels` filters to existing vessels) —
  // so assert it (a null must THROW, never silently zero extras and undercharge).
  const vessel = await repo.getVessel(hold.vesselId);
  if (!vessel) throw new Error(`held vessel ${String(hold.vesselId)} not found — cannot price fare`);
  const fare = composeFare({
    baseCents: priceCents,
    guestCount: req.guestCount,
    includedGuestCount: effectiveIncludedGuests(vessel),
    extraGuestPriceCents: offering!.extraGuestPriceCents,
  });

  const config = await repo.getPaymentConfig();
  const taxCents = taxCentsFor(fare.fareCents, config.taxRateBps);
  const amountCents = chargeNowCents(fare.fareCents, taxCents, config);
  const kind = config.depositMode === "deposit" ? "deposit" : "full";

  const session = await payments.createCheckoutSession({
    amountCents,
    taxCents,
    currency: "usd",
    productName: `Whole-boat charter — ${hold.date} ${hold.time}`,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    metadata: {
      purpose: "booking",
      // The SLOT — no eventId (the Event doesn't exist yet; the webhook materializes it).
      offeringId: String(offering!.id),
      vesselId: String(hold.vesselId),
      date: hold.date,
      time: hold.time,
      guestCount: String(req.guestCount),
      // The per-departure BASE (→ frozen `Event.price`); extras are billed on top (12.2).
      priceCents: String(priceCents),
      extrasCents: String(fare.extrasCents),
      kind,
      taxCents: String(taxCents),
      customerName: req.customerName,
      ...(req.email !== undefined ? { email: req.email } : {}),
      ...(req.phone !== undefined ? { phone: req.phone } : {}),
      waiverConsentAt: req.waiverConsentAt,
      waiverVersion: req.waiverVersion,
    },
  });
  return { ok: true, url: session.url, sessionId: session.id };
}
