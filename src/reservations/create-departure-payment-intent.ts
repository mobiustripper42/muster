/**
 * Create a departure PaymentIntent (Phase 12.5, DEC-134) — the live "Book & pay" path (the
 * hosted `createDepartureCheckout` twin was deleted at 14.5). Called at "Book & pay" submit from
 * the `/book/checkout` screen: waiver gate → gratuity-tier gate → CLAIM a fitting boat by writing
 * this checkout's pending row on it (fit-and-fallback) → mint a raw PaymentIntent carrying the
 * SLOT + the amount, and nothing else. The client confirms against the returned `clientSecret`; the
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
 * **The metadata is GONE (15.6, DEC-164, issue #812).** SPEC §2.8.5 says the booking charge sends
 * none, and §2.8.4 names `booking_invoice` — one value on our own row — as where the frozen money
 * belongs. Eighteen keys used to travel to Stripe and the webhook booked from them, four of them
 * the customer's own contact details. Nothing is sent now, and nothing reads it.
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
        | "departed"
        | "sold_out"
        | "waiver_required"
        | "gratuity_required"
        /** The intent this checkout already minted has been PAID, in another tab, moments ago
         *  (15.8). Not a failure — the customer is booked or about to be, and the one thing that
         *  must not happen is handing them a second payable charge. */
        | "already_paid";
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
      // What we are about to ask Stripe for, frozen HERE with everything else rather than
      // recomputed at the call site (15.4). It is the one money number the row cannot derive
      // from its own components: the deposit split lives in `config`, which is live and which an
      // operator can move while a card is being typed. Tip is added outside `chargeNowCents` —
      // no deposit-split and no tax on crew money (DEC-124).
      amountDueNowCents:
        chargeNowCents(fare.fareCents, taxCents, serviceFeeCents, config) + gratuityCents,
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
      // Both durations and the waiver version come from the PRIOR row on a retry, never re-read
      // from the offering (DEC-161, criterion 20): an operator lengthening a trip while a card is
      // being typed must not change what the hull owes this booking. `recordCheckoutAttempt` does
      // not write these columns either, so the freeze holds even if this line were wrong — but a
      // returned row that disagrees with the stored one is the trap that produced #946, and the
      // next person to add a column to that write would inherit it.
      holdMinutes: prior?.holdMinutes ?? candidateHoldMinutes(offering!),
      tripMinutes: prior?.tripMinutes ?? offering!.tripLengthMinutes ?? XOLA_TRIP_MINUTES,
      invoice,
      ...(req.holderToken !== undefined ? { holderToken: req.holderToken } : {}),
      ...(req.email !== undefined ? { email: req.email } : {}),
      ...(req.phone !== undefined ? { phone: req.phone } : {}),
      // Consent is re-stated every attempt — the buyer ticked the box again, and that instant is
      // the record of it. The VERSION is not: it is what they agreed to the first time, and
      // re-reading it would silently re-date the agreement to a document they never saw.
      waiverConsentAt,
      waiverVersion: prior?.waiverVersion ?? waiverVersion,
      // **Carried forward, and 15.8 depends on it.** The reuse path reads the last id this row
      // minted to decide whether to raise that intent or start another; without this the returned
      // row has none and every retry mints, which is the behaviour 15.8 exists to remove. Note the
      // reason is the OPPOSITE of the durations above: those are frozen so a later read cannot
      // change them, this is carried so a later read can see them.
      ...(prior?.paymentIntentIds !== undefined
        ? { paymentIntentIds: prior.paymentIntentIds }
        : {}),
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
  // The charge is READ from the frozen invoice rather than recomputed, so what Stripe is asked
  // for and what the row says cannot drift. Until 15.4 this line recomputed it from live
  // `config` — the comment claimed the freeze and the code did not have it, and an operator
  // moving `depositPercent` mid-checkout moved the charge away from the row that described it.
  const amountCents = invoice.amountDueNowCents;

  // ── Reuse this checkout's own intent, or mint a fresh one (15.8) ─────────────
  //
  // Stripe: *"If the checkout process is interrupted and resumes later, attempt to reuse the same
  // PaymentIntent instead of creating a new one"*, and *"you might need to update the amount when
  // they start the checkout process again"*.
  //
  // **Why this is a correctness fix and not tidiness.** Minting per attempt left every superseded
  // intent payable at the amount it was minted with. The row re-prices on each attempt, so a stale
  // tab could pay the four-guest quote against a six-guest booking, and after 15.6 the booking
  // records the row's numbers — so the crew tip on that booking is one the customer never paid.
  //
  // The reused id is the LAST one this row minted. Earlier ids stay on the row (§2.8.5) so a
  // superseded success is still findable; they are simply never offered to the customer again.
  const priorIntentId = pending.paymentIntentIds?.at(-1);
  // Caught here even though the port says this resolves `"unknown"` rather than throwing, and the
  // live adapter honours that. A docstring is not a guarantee — an adapter that throws would
  // otherwise take down a checkout that could simply have minted a new intent, and "the comment
  // said it could not happen" is how three defects got past review this week.
  const priorState = priorIntentId
    ? await payments.getPaymentIntentState(priorIntentId).catch(() => "unknown" as const)
    : ("unknown" as const);

  // **Already paid: refuse, never mint.** The row stays `pending` until the webhook lands or
  // `/book/success` runs, so there is an ordinary window — a dropped 3DS return, a closed tab, a
  // slow webhook — in which a paid intent is read back on a retry. Minting there gives the
  // customer a second payable secret for a booking they already bought, and nothing downstream
  // refunds it: the second confirm resolves `already`, writes a second Payment, and alerts nobody.
  //
  // `/security-review` found this as a HIGH, because my first cut put this refusal inside the
  // catch below — covering the seconds-wide race and not the ordinary case. The state is read on
  // every retry, so the direct read is how a paid intent is normally seen.
  if (priorIntentId && priorState === "settled") return { ok: false, reason: "already_paid" };

  if (priorIntentId && priorState === "reusable") {
    let raised: { clientSecret: string } | undefined;
    // **The try wraps the provider call and nothing else.** With `recordCheckoutAttempt` inside it,
    // a database blip was diagnosed as a refused update and could tell a customer their booking was
    // already paid when nothing had been (`/security-review`, in passing). A repository failure is
    // ours and belongs to the caller as a failure, not as a reassurance.
    try {
      raised = await payments.updatePaymentIntentAmount(priorIntentId, amountCents);
    } catch {
      // Refused. Ask why before minting: the dominant reason is that it just succeeded, in the
      // other tab, between the read above and this call.
      const nowSettled = await payments
        .getPaymentIntentState(priorIntentId)
        .catch(() => "unknown" as const);
      if (nowSettled === "settled") return { ok: false, reason: "already_paid" };
      // Genuinely dead, or refused for a reason we cannot see: fall through and mint. The old
      // intent is retired below rather than left behind (15.10).
    }
    if (raised) {
      // Nothing new to append — this attempt minted no id. The invoice and the customer's answers
      // still re-freeze, which is what `null` means here.
      await repo.recordCheckoutAttempt(pending, null);
      return { ok: true, clientSecret: raised.clientSecret, paymentIntentId: priorIntentId };
    }
  }

  // ── Retire the intent we are about to replace (15.10) ───────────────────────
  //
  // Reaching here with a `priorIntentId` means we decided not to offer that intent again — the
  // state was unreadable, or the amount update was refused for a reason that was not "it is already
  // paid" (that case returned above). 15.8 left it alone, which left it PAYABLE at its old amount:
  // a stale tab could still pay the four-guest quote against a six-guest booking, which is the
  // defect 15.8 set out to remove and closed only for the path where reuse succeeded.
  //
  // **Best-effort, and the refusals are the ordinary case rather than the exception.** Stripe
  // cancels only from `requires_payment_method`, `requires_confirmation`, `requires_action`,
  // `requires_capture` and rarely `processing`; an intent that is already cancelled or already
  // succeeded refuses. `unknown` — the state that brought most callers here — covers a read that
  // failed, a status we cannot describe, an id the provider never knew, and an already-cancelled
  // intent, and three of those four will refuse. A refusal must never reach the customer: by the
  // time this runs they are about to receive a working client secret for a fresh intent.
  if (priorIntentId) {
    await payments
      .cancelPaymentIntent(priorIntentId, "abandoned")
      .catch(() => undefined);
  }

  const intent = await payments.createPaymentIntent({
    amountCents,
    currency: "usd",
    // What a HUMAN reads on the charge (#679) — without it the dashboard's payments list is a
    // column of bare dollar amounts. Offering, departure, party size, who booked: enough to
    // answer a phone call without opening anything.
    //
    // **No metadata, at all (15.6).** Eighteen keys used to ride along, and the webhook booked
    // from them. Four were the customer's name, email, phone and consent timestamp — personal
    // data handed to a third party with no reader. The rest were money the reservation already
    // holds, frozen, in `booking_invoice`. `description` and `receiptEmail` are not metadata:
    // one is for a person reading the dashboard, the other tells Stripe to send a receipt.
    description: `${offering!.name} — ${req.date} ${req.time} · ${req.guestCount} guest${
      req.guestCount === 1 ? "" : "s"
    } · ${req.customerName}`,
    // Email is OPTIONAL at `/book` (phone is the identity, DEC-132), so this is absent on a
    // real and ordinary booking. Absent ⇒ Stripe sends no receipt; present ⇒ it does, in live
    // mode regardless of the account's email settings. Passing it is the decision to send one.
    ...(req.email !== undefined && req.email !== "" ? { receiptEmail: req.email } : {}),
    metadata: {},
  });
  // Stripe answered: APPEND its id to the row so confirm can find it (issue #916). Every id this
  // checkout has minted stays, oldest first (§2.8.5) — a superseded one that succeeds late still
  // resolves to this row. A GUARDED write, not a full-row upsert: the append is additive and the
  // invoice re-freezes only while the row is still `pending`, so a retry whose read landed before
  // a concurrent confirm cannot revert the just-booked, paid row to pending (@code-review).
  // `updatedAt` is the claim's clock, the same instant the row was written or re-priced under.
  await repo.recordCheckoutAttempt(pending, intent.paymentIntentId);
  return { ok: true, clientSecret: intent.clientSecret, paymentIntentId: intent.paymentIntentId };
}

/** A fresh `resv-<32 hex>` id per pending row, random: nothing deterministic exists yet to key
 *  it on (the intent id comes after the row). Confirm flips this row rather than deriving a new
 *  id from the payment (14.5) — which is what lets two payments resolve to one reservation. */
function mintPendingReservationId(): ReservationId {
  return asId<"ReservationId">(`resv-${randomUUID().replaceAll("-", "")}`);
}
