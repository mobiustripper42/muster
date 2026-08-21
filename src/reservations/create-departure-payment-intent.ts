/**
 * Create a departure PaymentIntent (Phase 12.5, DEC-134) — the inline-Elements twin of
 * `createDepartureCheckout` (12.1a, hosted). Called at "Book & pay" submit from the
 * `/book/checkout` screen: waiver gate → gratuity-tier gate → hold (15 min in production; `CHECKOUT_HOLD_MINUTES` shortens it locally) on a fitting boat
 * (fit-and-fallback) → price the held slot exactly as the deriver displayed it → compose the
 * fare → tax + gratuity + SERVICE FEE (DEC-134) → mint a raw PaymentIntent carrying the SLOT
 * + frozen money in metadata. The client confirms against the returned `clientSecret`; the
 * `payment_intent.succeeded` webhook books via `writeSlotBooking`, keyed on the intent id.
 *
 * **Writes no reservation.** The hold is the only pre-payment write; the reservation +
 * Payment land in the webhook (DEC-107/109). All money is FROZEN into metadata here — the
 * webhook never recomputes from live config (the DEC-107 freeze rule).
 */
import type { OfferingId } from "../domain/ids.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { resolveBasePrice, slotIdentity } from "./availability.js";
import { acquireDepartureHold } from "./claim.js";
import { chargeNowCents, feeCentsFor, taxCentsFor } from "./payment-config.js";
import {
  composeFare,
  effectiveIncludedGuests,
  gratuityCentsFor,
  gratuityTiersFor,
} from "./pricing.js";

export interface DeparturePaymentIntentRequest {
  offeringId: OfferingId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock "HH:MM". */
  time: string;
  guestCount: number;
  /** Chosen gratuity tier in basis points (DEC-124) — REQUIRED, must be one of the offering's
   *  tiers (no decline). The tip is a % of the fare, charged in full on top, untaxed. */
  gratuityBps: number;
  customerName: string;
  email?: string;
  phone?: string;
  /** Liability-waiver consent (DEC-110) — REQUIRED: no consent, no hold, no charge. */
  waiverConsentAt?: string;
  waiverVersion?: string;
  /**
   * The checkout session's holder token (#575) — read from an httpOnly cookie at the edge and
   * passed down. Proof of possession, so a retry reuses ITS OWN hold rather than taking a second
   * boat. Absent ⇒ mint every time, as before.
   */
  holderToken?: string;
}

export type DeparturePaymentIntentStart =
  | { ok: true; clientSecret: string; paymentIntentId: string }
  | {
      ok: false;
      reason:
        | "offering_missing"
        | "not_live"
        | "invalid_guest_count"
        | "off_schedule"
        | "sold_out"
        | "waiver_required"
        | "gratuity_required";
    };

export async function createDeparturePaymentIntent(
  repo: Repository,
  payments: PaymentPort,
  req: DeparturePaymentIntentRequest,
  now: () => string,
): Promise<DeparturePaymentIntentStart> {
  // Waiver is a hard gate (DEC-110) — check BEFORE acquiring a hold, so a consent-less
  // attempt never parks a hold on a boat.
  if (!req.waiverConsentAt || !req.waiverVersion) {
    return { ok: false, reason: "waiver_required" };
  }

  // Gratuity is REQUIRED, no decline (DEC-124) — the chosen tier must be one the offering
  // offers. Check before the hold (a bad tip never parks a boat). An absent offering falls
  // through to acquire's `offering_missing`.
  const offeringForTiers = await repo.getOffering(req.offeringId);
  if (offeringForTiers && !gratuityTiersFor(offeringForTiers).includes(req.gratuityBps)) {
    return { ok: false, reason: "gratuity_required" };
  }

  const held = await acquireDepartureHold(
    repo,
    {
      offeringId: req.offeringId,
      date: req.date,
      time: req.time,
      guestCount: req.guestCount,
      // Passed through from the edge's cookie (#575) — this module never derives it from the
      // customer's typed contact, which is what made the first version a hold hijack.
      ...(req.holderToken !== undefined ? { holderToken: req.holderToken } : {}),
    },
    now,
  );
  if ("unbookable" in held) {
    // Pass the reason straight through — the union is a superset of `unbookable` (issue #799 added
    // `off_schedule`), so mapping by hand only risks a new reason silently collapsing to the wrong
    // one (which is what an earlier `? … : invalid_guest_count` chain would have done here).
    return { ok: false, reason: held.unbookable };
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
  // extraGuestPrice. The vessel is guaranteed non-null — the hold assigned a real, fitting
  // boat — so assert it (a null must THROW, never silently zero extras and undercharge).
  const vessel = await repo.getVessel(hold.vesselId);
  if (!vessel) throw new Error(`held vessel ${String(hold.vesselId)} not found — cannot price fare`);
  const fare = composeFare({
    baseCents: priceCents,
    guestCount: req.guestCount,
    includedGuestCount: effectiveIncludedGuests(offering!, vessel),
    extraGuestPriceCents: offering!.extraGuestPriceCents,
  });

  const config = await repo.getPaymentConfig();
  const taxCents = taxCentsFor(fare.fareCents, config.taxRateBps);
  // Service fee (DEC-134): `serviceFeeBps` of the FARE only — independent of tax and tip,
  // charged IN FULL with the now-charge (like tax), frozen here, netted out of the balance.
  const serviceFeeCents = feeCentsFor(fare.fareCents, config.serviceFeeBps);
  // Gratuity (DEC-124): a % of the tip-free fare, added to the charge IN FULL and UNTAXED —
  // never through `chargeNowCents` (no deposit-split) or `taxCentsFor` (no tax). Crew money.
  const gratuityCents = gratuityCentsFor(fare.fareCents, req.gratuityBps);
  const amountCents =
    chargeNowCents(fare.fareCents, taxCents, serviceFeeCents, config) + gratuityCents;
  const kind = config.depositMode === "deposit" ? "deposit" : "full";

  const intent = await payments.createPaymentIntent({
    amountCents,
    currency: "usd",
    // Idempotency (#807): a declined-card retry reuses this hold (#575), so keying on the hold id
    // collapses the retries to one PaymentIntent. The amount is IN the key because a legitimate
    // tip change on retry reuses the hold at a different amount, and Stripe 400s an idempotency
    // replay whose parameters differ — so a hold-only key would reject the tip change. Distinct
    // amount ⇒ distinct key ⇒ a new intent for the new charge.
    idempotencyKey: `pi_${hold.id}:${amountCents}`,
    // What a HUMAN reads on the charge (#679). Metadata below is what the WEBHOOK reads, and
    // Stripe understands none of it — so before this the dashboard's payments list was a column
    // of bare dollar amounts. Offering, departure, party size, who booked: enough to answer a
    // phone call without opening anything.
    description: `${offering!.name} — ${hold.date} ${hold.time} · ${req.guestCount} guest${
      req.guestCount === 1 ? "" : "s"
    } · ${req.customerName}`,
    // Email is OPTIONAL at `/book` (phone is the identity, DEC-132), so this is absent on a
    // real and ordinary booking. Absent ⇒ Stripe sends no receipt; present ⇒ it does, in live
    // mode regardless of the account's email settings. Passing it is the decision to send one.
    ...(req.email !== undefined && req.email !== "" ? { receiptEmail: req.email } : {}),
    metadata: {
      // The double-write-guard discriminator (DEC-134): only purposed intents book.
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
      // Gratuity portion of amountCents (crew money; netted out of balance) + tier provenance.
      gratuityCents: String(gratuityCents),
      gratuityBps: String(req.gratuityBps),
      // Service-fee portion of amountCents (DEC-134; netted out of balance like the tip).
      serviceFeeCents: String(serviceFeeCents),
      kind,
      taxCents: String(taxCents),
      customerName: req.customerName,
      ...(req.email !== undefined ? { email: req.email } : {}),
      ...(req.phone !== undefined ? { phone: req.phone } : {}),
      waiverConsentAt: req.waiverConsentAt,
      waiverVersion: req.waiverVersion,
    },
  });
  return { ok: true, clientSecret: intent.clientSecret, paymentIntentId: intent.paymentIntentId };
}
