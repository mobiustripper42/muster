/**
 * The customer pays an operator's phone booking (issue #1082 part B, SPEC §2.10.6).
 *
 * The operator's `admin` row already holds the boat and carries the invoice frozen when they booked
 * (`operator-booking.ts`), so there is nothing to claim and nothing to price: each attempt at `/p`
 * puts a payable intent on that row through `attachPaymentIntent`, the checkout's own reuse rules,
 * and the ordinary confirm books it (§2.8.6) — turning it `muster` in the same write.
 *
 * **Only an unpaid operator's row is payable here.** A paid one is an ordinary `muster` booking; a
 * web checkout's pending row belongs to the browser that started it (its holder token), not to
 * whoever holds a link. Anything else is `missing`, the same answer as no row at all.
 */
import type { Block, BookingInvoice, Offering, Reservation } from "../domain/entities.js";
import { logSwallowed } from "../log.js";
import { balanceDueOn, type CheckoutQuote, type ScreenTotals } from "./checkout-quote.js";
import { asId, type ReservationId } from "../domain/ids.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { balanceDates, hasDeparted, insideBalanceWindow, isSlotBlocked } from "./availability.js";
import { hasBalance } from "./booking-invoice.js";
import {
  attachPaymentIntent,
  priorIntentState,
  shownIsStale,
} from "./create-departure-payment-intent.js";
import { flexChargedCents } from "./discount.js";
import { candidateTripMinutes, XOLA_TRIP_MINUTES } from "./hull-busy.js";
import { depositOffered, dueNowCents, type PaymentConfig } from "./payment-config.js";
import { recordTrail } from "./trail.js";

/** What a payment link opens onto. The `/p` page renders one state per kind. */
export type PayLinkState =
  | { kind: "payable"; reservation: Reservation }
  | { kind: "paid"; reservation: Reservation }
  | { kind: "cancelled"; reservation: Reservation }
  | { kind: "missing" };

export function payLinkState(r: Reservation | null): PayLinkState {
  if (!r) return { kind: "missing" };
  if (r.status === "booked") return { kind: "paid", reservation: r };
  if (r.status === "cancelled") return { kind: "cancelled", reservation: r };
  // Owing nothing is not payable (DEC-194): a comp whose own confirm failed after the write sits
  // here pending with $0 due, and a $0 payment must never reach the provider.
  if (r.source === "admin" && r.status === "pending" && (r.invoice?.amountDueNowCents ?? 0) > 0) {
    return { kind: "payable", reservation: r };
  }
  return { kind: "missing" };
}

/** What the customer's pay link may do now (issue #1279): `payLinkState`, plus a trip that has
 *  left and a slot under a block. */
export type PayLinkStateAt =
  | PayLinkState
  | { kind: "departed"; reservation: Reservation }
  | { kind: "blocked"; reservation: Reservation };

/**
 * The check (issue #1279): may this pay link take money now? Only the customer's page and the Pay
 * press ask it; the operator's booking page keeps `payLinkState`. The order is fixed: no row is
 * `missing`; anything `payLinkState` does not call `payable` keeps that answer; then a trip that has
 * left is `departed` (so a booking both departed and blocked reads departed); then a slot under a
 * block is `blocked`; otherwise `payable`.
 */
export function payLinkStateAt(
  r: Reservation | null,
  at: { asOf: string; blocks: readonly Block[]; offering: Offering | null },
): PayLinkStateAt {
  const state = payLinkState(r);
  if (state.kind !== "payable") return state;
  const reservation = state.reservation;
  if (reservation.date && reservation.time && hasDeparted(reservation.date, reservation.time, at.asOf)) {
    return { kind: "departed", reservation };
  }
  if (slotBlockedFor(at.blocks, reservation, at.offering)) return { kind: "blocked", reservation };
  return state;
}

/**
 * Is this booking's slot under these blocks (issue #1279)? The one home of the rule, for the pay
 * link's check and the blocks page's count. `isSlotBlocked` is the calendar's own function; the
 * booking supplies its vessel, date and time, so a reservation without all three is never blocked.
 * The location is the offering's, none when the offering is gone; the trip length is the
 * reservation's own, else the offering's, else the Xola stand-in (as `block-impact.ts` falls back).
 */
export function slotBlockedFor(
  blocks: readonly Block[],
  r: Reservation,
  offering: Pick<Offering, "locationId" | "tripLengthMinutes"> | null | undefined,
): boolean {
  if (!r.vesselId || !r.date || !r.time) return false;
  const locationId = offering ? String(offering.locationId) : "";
  const tripMinutes = r.tripMinutes ?? (offering ? candidateTripMinutes(offering) : XOLA_TRIP_MINUTES);
  return isSlotBlocked(blocks, locationId, r.vesselId, r.date, r.time, tripMinutes);
}

/** An unpaid phone booking (issue #1279): an operator's reservation still pending — a comp waiting
 *  to confirm included. The one home of the question, for the blocks page's count and the hold's
 *  refusal. */
export function isUnpaidPhoneBooking(r: Reservation): boolean {
  return r.source === "admin" && r.status === "pending";
}

/** Did this cancelled booking take a card payment? Decides which Cancelled card `/p` shows
 *  (issue #1266). */
export function cancelledWasCharged(r: Reservation): boolean {
  return r.source !== "admin" && (r.paymentIntentIds ?? []).length > 0;
}

/**
 * The checkout's money shape, read off the invoice frozen when the operator booked — never
 * re-priced. The price is the operator's; the split (what is charged now, what is left, the balance
 * day) is the live settings' at `split.asOf`, worked out from `inv.totalCents` every time and never
 * from the `amountDueNowCents` the row happens to hold — a deposit attempt leaves that at the
 * deposit (issue #1251). The tip is the tier the operator asked on the phone, fixed.
 *
 * The invoice keeps the extras' total but not how many guests the fare covers or the per-guest
 * price, so those come back as 0 and the summary labels the rows "Fare" and "Extra guests" rather
 * than inventing a count from live config (the same call as the operator's pane, issue #1104).
 *
 * **`totals` are the invoice's own figures, never a recompute** (16.8). The tip and the insurance
 * are fixed here, so there is nothing to re-total — and an unpaid booking frozen under an older fee
 * rule (DEC-196 moved the tip into the fee's base) must show what it will actually be charged.
 */
export function payLinkMoney(
  inv: BookingInvoice,
  split: { config: PaymentConfig; date: string; time: string; asOf: string },
): {
  money: Omit<CheckoutQuote, "tiers" | "defaultBps">;
  tip: { bps: number; tipCents: number };
  totals: ScreenTotals;
} {
  const { config, date, time, asOf } = split;
  // The one place a deposit is offered or not, at the page and at the pay.
  const depositCents = depositOffered(inv.totalCents, config.depositCents, insideBalanceWindow(date, time, asOf, config))
    ? config.depositCents
    : null;
  // The tip- and insurance-free share of the whole quote, for the shape's sake — the screen reads `totals`.
  const dueNowBeforeTipCents = inv.totalCents - inv.gratuityCents - flexChargedCents(inv);
  // The deposit-preselected screen: what `splitFrozen` (components/checkout/money.ts) gives the
  // form's deposit choice. Core cannot import a component, so the same `dueNowCents` is called here.
  const dueNow = dueNowCents(inv.totalCents, depositCents);
  return {
    totals: {
      tipCents: inv.gratuityCents,
      flexCents: inv.flexCents ?? 0,
      taxCents: inv.taxCents,
      serviceFeeCents: inv.serviceFeeCents,
      totalCents: inv.totalCents,
      dueNowCents: dueNow,
      balanceCents: inv.totalCents - dueNow,
    },
    money: {
      // Undiscounted, with the discount as its own row (DEC-194) — the summary subtracts it.
      fareCents: inv.fareCents + inv.extrasCents,
      discountCents: inv.discountCents ?? 0,
      baseCents: inv.fareCents,
      extraGuests: 0,
      extrasCents: inv.extrasCents,
      extraGuestPriceCents: 0,
      includedGuests: 0,
      taxCents: inv.taxCents,
      taxRateBps: inv.taxRateBps,
      serviceFeeCents: inv.serviceFeeCents,
      serviceFeeBps: inv.serviceFeeBps,
      dueNowBeforeTipCents,
      depositCents,
      balanceDueOn: depositCents === null ? null : balanceDueOn(date, time, config),
      flexCents: inv.flexCents ?? 0,
    },
    tip: { bps: inv.gratuityBps, tipCents: inv.gratuityCents },
  };
}

/** "+12165550199" → "(216) 555-…99": enough to recognise your own number, not enough to hand a
 *  stranger holding a forwarded link the whole thing. Read from the digits, because older and
 *  seeded rows store the number as it was typed; a non-US number keeps its last two digits. */
export function maskedPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return `…${digits.slice(-2)}`;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-…${national.slice(8)}`;
}

export type PayByLinkStart =
  | { ok: true; clientSecret: string; paymentIntentId: string }
  | {
      ok: false;
      /** `paid`: the row is booked. `already_paid`: its intent was paid moments ago and the
       *  confirm hasn't landed yet (15.8) — either way, never a second charge. */
      reason: "missing" | "paid" | "cancelled" | "already_paid" | "departed" | "blocked";
    }
  | {
      ok: false;
      /** The split the page showed is not the split this payment would make (issue #1251): the
       *  trip crossed into the balance window, or the deposit setting moved. Nothing was written. */
      reason: "stale";
    };

/**
 * Pay the phone booking by link. The customer's choice and the figures their page showed arrive as
 * `choice`; the split is decided here from the live settings and the clock (issue #1251), written
 * into the row's due-now field and dates, and the price on the invoice is left as the operator
 * froze it. A payment whose split is not the one shown is refused before anything is written.
 */
export async function startPayByLink(
  deps: { repo: Repository; payments: PaymentPort; now: () => string },
  reservationId: ReservationId,
  choice: { payDeposit: boolean; shownDueNowCents?: number; shownBalanceCents?: number },
): Promise<PayByLinkStart> {
  // The check (issue #1279), before Stripe is asked: the booking may since have been cancelled or
  // blocked, or its trip may have left, since the form that pressed Pay was opened.
  const { state, offering } = await readCheck(deps, reservationId);
  if (state.kind !== "payable") return { ok: false, reason: state.kind };
  const stored = state.reservation;
  const frozen = stored.invoice!; // payable means an operator's row with an invoice

  // The split, from the live settings and the clock — the page's own function, so the two cannot
  // disagree about whether a deposit is offered. An operator's row names its slot.
  const config = await deps.repo.getPaymentConfig();
  const date = stored.date!;
  const time = stored.time!;
  const { money } = payLinkMoney(frozen, { config, date, time, asOf: deps.now() });
  const invoice: BookingInvoice = {
    ...frozen,
    amountDueNowCents: dueNowCents(frozen.totalCents, choice.payDeposit ? money.depositCents : null),
  };

  // Already paid before stale, as the checkout does: a customer whose other tab paid is never told
  // "you have not been charged".
  if (shownIsStale(invoice, choice.shownDueNowCents, choice.shownBalanceCents)) {
    return (await priorIntentState(deps.payments, stored)) === "settled"
      ? { ok: false, reason: "already_paid" }
      : { ok: false, reason: "stale" };
  }

  // The attempt's row: this split, and its dates only when it leaves a balance — never the stored
  // row's carried forward, so Pay in full after a deposit attempt clears them.
  const { balanceDueAt: _dueAt, balanceReleaseAt: _releaseAt, ...bare } = stored;
  const dates = hasBalance(invoice) ? balanceDates(date, time, config) : null;
  const row: Reservation = {
    ...bare,
    invoice,
    ...(dates ? { balanceDueAt: dates.dueAt, balanceReleaseAt: dates.releaseAt } : {}),
  };

  // The dashboard line, shaped like checkout's (#679). The offering may have been renamed or
  // retired since the booking; the charge still goes through, named for what is left.
  const guests = row.partySize ?? 0;
  const description = [
    `${offering?.name ?? "Charter"} — ${row.date ?? ""} ${row.time ?? ""}`.trim(),
    `${guests} guest${guests === 1 ? "" : "s"}`,
    row.customerName,
    "phone booking",
  ].join(" · ");

  const attached = await attachPaymentIntent(
    deps,
    row,
    {
      description,
      ...(row.email ? { receiptEmail: row.email } : {}),
    },
    undefined,
    // What the last intent was minted for: the stored split, before this attempt rewrites it.
    { priorHadBalance: hasBalance(frozen) },
  );
  if (!attached.ok) return attached;

  // The second check (issue #1279), after Stripe answered and before the customer is handed the card
  // form: the whole check again on fresh reads, reusing none of the first's values. The attempt can
  // be seconds long, and a cancel, a block or the departure can land inside it. If it no longer
  // passes, the payment this attempt made (or raised) is cancelled at Stripe and the customer
  // never receives its client secret, so nothing can be paid on it.
  const again = (await readCheck(deps, reservationId)).state;
  if (again.kind !== "payable") {
    await retireRefusedIntent(deps, reservationId, attached.paymentIntentId);
    return { ok: false, reason: again.kind };
  }
  return attached;
}

/** One reading of the check: the reservation, the blocks, its offering and the clock. */
async function readCheck(
  deps: { repo: Repository; now: () => string },
  reservationId: ReservationId,
): Promise<{ state: PayLinkStateAt; offering: Offering | null }> {
  const reservation = await deps.repo.getReservation(reservationId);
  const blocks = await deps.repo.listBlocks();
  const offering = reservation?.offeringId ? await deps.repo.getOffering(reservation.offeringId) : null;
  return { state: payLinkStateAt(reservation, { asOf: deps.now(), blocks, offering }), offering };
}

/**
 * Cancel the payment a refused attempt made, at Stripe, and say so in the history when the cancel
 * took. Best-effort and never thrown: the customer is refused whether or not Stripe cancels, because
 * they never received the secret, and a payment that lands anyway is the admin text's (AC7, AC8).
 */
async function retireRefusedIntent(
  deps: { repo: Repository; payments: PaymentPort; now: () => string },
  reservationId: ReservationId,
  paymentIntentId: string,
): Promise<void> {
  try {
    await deps.payments.cancelPaymentIntent(paymentIntentId, "abandoned");
  } catch (e) {
    logSwallowed(
      "reservations:payLinkRefusedIntent",
      e,
      `could not cancel intent ${paymentIntentId} for a pay link that stopped being payable`,
    );
    return;
  }
  // Only when the cancel took: a `payment_superseded` row for an intent still payable would assert
  // the one state somebody opens the history to check (issue #1051). Derived id, as in `attachPaymentIntent`.
  await recordTrail(deps, {
    id: asId<"TrailEventId">(`payment_superseded:${paymentIntentId}`),
    reservationId,
    paymentIntentId: asId<"PaymentIntentId">(paymentIntentId),
    actorKind: "engine",
    type: "payment_superseded",
    metadata: { reason: "the booking stopped being payable while the payment was set up" },
  });
}
