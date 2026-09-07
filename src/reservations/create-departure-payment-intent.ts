/**
 * Create a departure PaymentIntent (Phase 12.5, DEC-134) — the live "Book & pay" path (the
 * hosted `createDepartureCheckout` twin was deleted at 14.5). Called at "Book & pay" submit from
 * the `/book/checkout` screen: waiver gate → gratuity-tier gate → CLAIM a fitting boat by writing
 * this checkout's pending row on it (fit-and-fallback) → mint a raw PaymentIntent carrying the
 * SLOT + frozen money in metadata. The client confirms against the returned `clientSecret`; the
 * `payment_intent.succeeded` webhook FLIPS the pending row via `confirmPendingRow` (§2.8.6),
 * found by the intent id recorded on it.
 *
 * **Writes the PENDING reservation before Stripe (14.4, SPEC §2.8.2).** The row names the slot
 * (no Event yet), freezes both durations (DEC-161) and the whole invoice (DEC-164), and picks up
 * the payment-intent id once Stripe answers.
 *
 * **The boat is picked by `claimDepartureSlot`, not here (14.7).** This module supplies a builder
 * that prices a row for whichever hull the claim is trying, and the claim writes it; a lost write
 * falls through to the next boat rather than ending the checkout. Before 14.7 a `checkout_holds`
 * row picked the hull first and this module wrote the pending row afterwards, all-or-nothing — so
 * a race lost at that write reported `sold_out` with a free boat sitting next to it.
 *
 * **The metadata is on its way out (DEC-164, issue #812).** SPEC §2.8.5 says the booking charge
 * sends none, and §2.8.4 names `booking_invoice` — one value on our own row — as where the frozen
 * money belongs. The row now carries it and every metadata number below is read back off it; the
 * keys stay until `booking-webhook.ts` reads the row instead.
 *
 * This block used to credit "the DEC-107 freeze rule". DEC-107 ruled the **opposite** — tax read
 * live, not frozen — and is retired; it is now a signpost to §2.8.4a. Removed rather than
 * repointed, because a citation for a rule nobody made is worse than none.
 */
import { randomUUID } from "node:crypto";
import type { BookingInvoice, Reservation } from "../domain/entities.js";
import { asId, type OfferingId, type ReservationId, type VesselId } from "../domain/ids.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { resolveBasePrice, slotIdentity } from "./availability.js";
import { claimDepartureSlot } from "./claim.js";
import { candidateHoldMinutes, XOLA_TRIP_MINUTES } from "./hull-busy.js";
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
  // Bound here rather than read off `req` inside the builder closure: narrowing from the guard
  // above does not survive into a closure, and `exactOptionalPropertyTypes` will not take a
  // `string | undefined` for a required field.
  const { waiverConsentAt, waiverVersion } = req;

  // Gratuity is REQUIRED, no decline (DEC-124) — the chosen tier must be one the offering
  // offers. Check before the hold (a bad tip never parks a boat). An absent offering falls
  // through to acquire's `offering_missing`.
  const offeringForTiers = await repo.getOffering(req.offeringId);
  if (offeringForTiers && !gratuityTiersFor(offeringForTiers).includes(req.gratuityBps)) {
    return { ok: false, reason: "gratuity_required" };
  }

  // Everything the builder below prices from, read once. A null `offering` falls through to the
  // claim's `offering_missing`, which is why the builder may assert it non-null.
  const offering = await repo.getOffering(req.offeringId);
  const config = await repo.getPaymentConfig();
  const events = await repo.listEvents();
  const vesselById = new Map((await repo.listVessels()).map((v) => [String(v.id), v]));

  // ── The pending row, BEFORE Stripe (14.4, SPEC §2.8.2–2.8.4) ─────────────────
  // From here the booking exists on our side: the slot it names, both durations and every money
  // component frozen (DEC-161, DEC-164). An operator edit landing while the customer types a
  // card number changes nothing about this booking (criterion 20), and a provider that hangs or
  // 502s leaves the row rather than the customer's quote. Written under the hull-day lock with
  // the same measure the deriver uses — the row's hold minutes — so a rival cannot slip a second
  // row onto the hull between our read and our write.
  //
  // The BOAT is not ours to pick (14.7): `claimDepartureSlot` runs fit-and-fallback and calls
  // this builder for each hull it is willing to try, because an override Event prices one boat's
  // departure and not another's. Everything about money stays here; everything about which boat
  // stays there. On a retry the claim hands back the session's existing row as `prior` and skips
  // the write entirely — the row already exists and already occupies the hull.
  const buildPendingRow = (vesselId: VesselId, prior: Reservation | null, at: string): Reservation => {
    // Price this slot exactly as displayed: an override Event's price wins, else the first-match
    // variation off the base (DEC-125). Offering is always priced (basePriceCents).
    const key = slotIdentity(vesselId, req.date, req.time);
    const slotEvent = events.find(
      (e) =>
        e.source === "muster" &&
        e.status === "scheduled" &&
        slotIdentity(e.vesselId, e.date, e.time) === key,
    );
    const priceCents = slotEvent?.price ?? resolveBasePrice(offering!, req.date);

    // Compose the party fare (DEC-112 / DEC-125 build note, 12.2): base + extra-guests ×
    // extraGuestPrice. The vessel is guaranteed non-null — the claim only offers boats it read
    // out of `listVessels` — so assert it (a null must THROW, never silently zero extras and
    // undercharge).
    const vessel = vesselById.get(String(vesselId));
    if (!vessel) throw new Error(`claimed vessel ${String(vesselId)} not found — cannot price fare`);
    const fare = composeFare({
      baseCents: priceCents,
      guestCount: req.guestCount,
      includedGuestCount: effectiveIncludedGuests(offering!, vessel),
      extraGuestPriceCents: offering!.extraGuestPriceCents,
    });
    const taxCents = taxCentsFor(fare.fareCents, config.taxRateBps);
    // Service fee (DEC-134): `serviceFeeBps` of the FARE only — independent of tax and tip,
    // charged IN FULL with the now-charge (like tax), frozen here, netted out of the balance.
    const serviceFeeCents = feeCentsFor(fare.fareCents, config.serviceFeeBps);
    // Gratuity (DEC-124): a % of the tip-free fare, added to the charge IN FULL and UNTAXED —
    // never through `chargeNowCents` (no deposit-split) or `taxCentsFor` (no tax). Crew money.
    const gratuityCents = gratuityCentsFor(fare.fareCents, req.gratuityBps);
    // `totalCents` is the whole quote, not the amount charged now: in deposit mode the charge is
    // `chargeNowCents` and the remainder is collected later against this same invoice.
    const invoice: BookingInvoice = {
      fareCents: priceCents,
      extrasCents: fare.extrasCents,
      taxCents,
      taxRateBps: config.taxRateBps,
      serviceFeeCents,
      serviceFeeBps: config.serviceFeeBps,
      gratuityCents,
      gratuityBps: req.gratuityBps,
      totalCents: fare.fareCents + taxCents + serviceFeeCents + gratuityCents,
    };
    return {
      // The SAME row on a retry — its id is the booking's for life. Reserved time is set on the
      // FIRST write and never moved (§2.8.7): a resubmit must not park the hull indefinitely by
      // pushing the window forward. The invoice IS re-frozen every attempt, so a tip change
      // reprices.
      id: prior?.id ?? mintPendingReservationId(),
      eventId: null,
      source: "muster",
      status: "pending",
      customerName: req.customerName,
      partySize: req.guestCount,
      vesselId,
      date: req.date,
      time: req.time,
      offeringId: offering!.id,
      reservedAt: prior?.reservedAt ?? at,
      holdMinutes: candidateHoldMinutes(offering!),
      tripMinutes: offering!.tripLengthMinutes ?? XOLA_TRIP_MINUTES,
      invoice,
      ...(req.holderToken !== undefined ? { holderToken: req.holderToken } : {}),
      ...(req.email !== undefined ? { email: req.email } : {}),
      ...(req.phone !== undefined ? { phone: req.phone } : {}),
      waiverConsentAt,
      waiverVersion,
      updatedAt: at,
    };
  };

  const claim = await claimDepartureSlot(
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
    buildPendingRow,
    now,
  );
  if ("unbookable" in claim) {
    // Pass the reason straight through — the union is a superset of `unbookable` (issue #799 added
    // `off_schedule`), so mapping by hand only risks a new reason silently collapsing to the wrong
    // one (which is what an earlier `? … : invalid_guest_count` chain would have done here).
    return { ok: false, reason: claim.unbookable };
  }
  // Sold out means EVERY fitting hull was refused — by the read or by its own write CAS. Since
  // 14.7 a single lost write is no longer this: the claim moves to the next boat.
  if ("soldOut" in claim) return { ok: false, reason: "sold_out" };

  const pending = claim.claimed;
  const invoice = pending.invoice!; // the builder above always sets it
  // The charge is rebuilt from the frozen invoice rather than recomputed, so what Stripe is asked
  // for and what the row says cannot drift. `fare.fareCents` is base + extras by construction.
  const fareCents = invoice.fareCents + invoice.extrasCents;
  const amountCents =
    chargeNowCents(fareCents, invoice.taxCents, invoice.serviceFeeCents, config) +
    invoice.gratuityCents;
  const kind = config.depositMode === "deposit" ? "deposit" : "full";

  const intent = await payments.createPaymentIntent({
    amountCents,
    currency: "usd",
    // What a HUMAN reads on the charge (#679). Metadata below is what the WEBHOOK reads, and
    // Stripe understands none of it — so before this the dashboard's payments list was a column
    // of bare dollar amounts. Offering, departure, party size, who booked: enough to answer a
    // phone call without opening anything.
    description: `${offering!.name} — ${req.date} ${req.time} · ${req.guestCount} guest${
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
      // The hull the CLAIM picked, not the one this module guessed — fit-and-fallback may have
      // moved off the smallest boat, and metadata naming the wrong one would materialize the
      // Event on a boat nobody reserved.
      vesselId: String(pending.vesselId),
      date: req.date,
      time: req.time,
      guestCount: String(req.guestCount),
      // Every number below is read off the row's FROZEN invoice, so the charge, the metadata and
      // the reservation cannot disagree about what was quoted.
      // The per-departure BASE (→ frozen `Event.price`); extras are billed on top (12.2).
      priceCents: String(invoice.fareCents),
      extrasCents: String(invoice.extrasCents),
      // Gratuity portion of amountCents (crew money; netted out of balance) + tier provenance.
      gratuityCents: String(invoice.gratuityCents),
      gratuityBps: String(req.gratuityBps),
      // Service-fee portion of amountCents (DEC-134; netted out of balance like the tip).
      serviceFeeCents: String(invoice.serviceFeeCents),
      kind,
      taxCents: String(invoice.taxCents),
      customerName: req.customerName,
      ...(req.email !== undefined ? { email: req.email } : {}),
      ...(req.phone !== undefined ? { phone: req.phone } : {}),
      waiverConsentAt: req.waiverConsentAt,
      waiverVersion: req.waiverVersion,
    },
  });
  // Stripe answered: APPEND its id to the row so confirm can find it (issue #916). Every id this
  // checkout has minted stays, oldest first (§2.8.5) — a superseded one that succeeds late still
  // resolves to this row. A GUARDED write, not a full-row upsert: the append is additive and the
  // invoice re-freezes only while the row is still `pending`, so a retry whose read landed before
  // a concurrent confirm cannot revert the just-booked, paid row to pending (@code-review).
  // `updatedAt` is the claim's clock, the same instant the row was written or re-priced under.
  await repo.appendPaymentIntentToPending(pending.id, invoice, intent.paymentIntentId, pending.updatedAt!);
  return { ok: true, clientSecret: intent.clientSecret, paymentIntentId: intent.paymentIntentId };
}

/** A fresh `resv-<32 hex>` id per pending row, random: nothing deterministic exists yet to key
 *  it on (the intent id comes after the row). Confirm flips this row rather than deriving a new
 *  id from the payment (14.5) — which is what lets two payments resolve to one reservation. */
function mintPendingReservationId(): ReservationId {
  return asId<"ReservationId">(`resv-${randomUUID().replaceAll("-", "")}`);
}
