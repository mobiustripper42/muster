/**
 * The operator's cancel-and-refund (issue #1212), moved out of `cancelBooking`'s `"use server"`
 * file so every exit reaches one send and can be tested. What stays at the edge is the auth check,
 * reading the form, and applying the result: the draft call and the redirect.
 *
 * Each exit returns the redirect's params and what to do with the form draft, exactly as
 * `cancelBooking` did before the move. A press that cancelled gains `told` in `params` when the
 * customer was asked to be told (`tellSafely`).
 */
import { randomUUID } from "node:crypto";
import { zonedWallClockToInstant } from "../config/tenant.js";
import type { FormResult } from "../builder/form-shifts.js";
import type { CancelledBy, NewRefundRecord, Payment } from "../domain/entities.js";
import { asId, type ReservationId } from "../domain/ids.js";
import { logSwallowed } from "../log.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { insuranceOf } from "./booking-invoice.js";
import {
  noRefundSentNotice,
  tellSafely,
  type CancelNoticeActor,
  type CancelNoticeRefund,
  type TellCustomer,
} from "./cancel-notice.js";
import { cancelReservation, quoteCancelRefund, type CancelQuote } from "./cancel-reservation.js";
import { parseDollarsToCents } from "./dollars.js";
import { refundableTotalFor, sendRefundRecord } from "./refund-payment.js";
import { recordTrail } from "./trail.js";

export interface OperatorCancelDeps {
  repo: Repository;
  now: () => string;
  /** Absent is the deploy with no Stripe keys, and reports `stripe_not_configured`. */
  payments?: PaymentPort;
  /** A cancel collapses the shift, and the crew on it have to be TOLD (DEC-084/#244). */
  relayFormNotices?: (f: FormResult) => Promise<void>;
  tellCustomer?: TellCustomer;
  /** Text every active admin, with a link when there is one (issue #1278): a refund that fell short
   *  or was never confirmed, when no redirect is there to say so. */
  alert: (message: string, href?: string) => Promise<void>;
}

export interface OperatorCancelInput {
  reservationId: ReservationId;
  by: CancelledBy;
  /** Raw from the form. */
  typedAmount: string;
  /** Raw from the form. */
  expectedRefunded: string;
  adminId: string;
}

export interface OperatorCancelResult {
  params: Record<string, string>;
  /** What the edge does with the operator's form draft. */
  draft: "stash" | "clear" | "leave";
}

/**
 * Cancel the booking (#616) and refund, in the same press (operator, 2026-08-10) — the figure the
 * confirm's box holds, or the published-terms figure for the reason posted when it is blank.
 *
 * Writes the reservation AND its event to `cancelled`, in one save, which is what actually frees the boat. See
 * `cancelReservation` for why both. **The same save writes the refund it owes** (issue #1278): a record,
 * unfinished, so a cancel never commits with its refund lost. The press then sends that record. Never
 * rejects.
 *
 * **The figure is settled BEFORE the cancel.** A typed amount that is not money, or more than the
 * booking can give back, is refused with nothing cancelled (AC3), because the record cannot be written
 * for it. Everything else cancels (AC31): when the refund then cannot be sent — a stale token, a
 * charge with no PaymentIntent — the record is closed short and the redirect says why, and an admin
 * refunds by hand.
 */
export async function cancelByOperator(
  deps: OperatorCancelDeps,
  input: OperatorCancelInput,
): Promise<OperatorCancelResult> {
  const { reservationId, by, adminId } = input;
  const actor: CancelNoticeActor = { kind: "admin", id: adminId };
  const trailDeps = { repo: deps.repo, now: deps.now };

  /** The result for a press that cancelled: the customer is told last, after the cancel and the
   *  refund (DEC-198), so the message can state the figure. */
  const cancelled = async (
    params: Record<string, string>,
    draft: OperatorCancelResult["draft"],
    refund: CancelNoticeRefund,
  ): Promise<OperatorCancelResult> => {
    const told = await tellSafely(deps.tellCustomer, reservationId, by, refund, actor);
    return { params: told ? { ...params, told } : params, draft };
  };

  // ── The figure, settled before anything is cancelled (issue #1278, AC3) ─────────
  //
  // **The amount is computed HERE when the box is blank**, from the reason actually posted. That
  // is not a convenience, it is the correctness argument for the whole design: with no client JS
  // a prefilled box cannot follow the radio, so a prefill would let "We cancelled" refund at the
  // customer rate whenever the operator didn't retype. A blank box has no wrong value to carry.
  //
  // The published-terms figure is computed on BOTH paths. It is the refund amount when the operator
  // typed nothing, and the COMPARISON when they did — the record carries it so the delta is readable
  // later without recomputing terms that may since have changed (issue #1050).
  //
  // **Read from the booking's own trip**, not from the trip the cancel freed: the cancel's write now
  // carries the record, so the figure has to exist before it, and a trip another booking still holds
  // used to read as "no figure" and refund nothing.
  //
  // No event ⇒ no departure instant ⇒ no notice window, so the figure cannot be derived at all.
  // Cancel stands; the operator refunds by hand from the box, and the record simply has no
  // `quotedCents` — which means "there was no policy figure", not "it matched". A failed read is
  // the same answer: `null`. The quote is kept whole so the notice can read what was paid.
  const typed = input.typedAmount.trim();
  let quote: CancelQuote | null = null;
  let payments: Payment[] | null = null;
  try {
    payments = await deps.repo.listPaymentsForReservation(reservationId);
    const row = await deps.repo.getReservation(reservationId);
    const event = row?.eventId ? await deps.repo.getEvent(row.eventId) : null;
    if (event) {
      quote = quoteCancelRefund({
        by,
        payments,
        departureAt: zonedWallClockToInstant(event.date, event.time),
        now: new Date(deps.now()),
        // What the customer bought (16.8): insurance makes it 72 hours and no $50, keeping itself.
        insurance: insuranceOf(row?.invoice),
      });
    }
  } catch (e) {
    logSwallowed("reservations:cancelByOperator", e, "no published-terms figure; the operator refunds by hand");
  }
  const quotedCents = quote ? quote.refundCents : null;

  let refundCents: number | null;
  if (typed === "") {
    refundCents = quotedCents;
  } else {
    const parsed = parseDollarsToCents(typed);
    // Nothing is cancelled for an amount that is not money, or that no record could ask for: the
    // confirm screen comes back with what was typed, and the customer is told nothing.
    if (parsed === null) return { params: { cancelErr: "invalid_amount" }, draft: "stash" };
    // The ceiling is the number the plan is checked against.
    if (payments !== null && parsed > refundableTotalFor(payments)) {
      return { params: { cancelErr: "exceeds_refundable" }, draft: "stash" };
    }
    refundCents = parsed;
  }

  // The record this cancel owes. Zero is a legitimate outcome, not a failure: inside the 14-day window
  // the published terms owe nothing, and the operator can type 0 to cancel without refunding. The
  // exits with no Stripe keys or no usable token write no record and cancel all the same (AC31).
  const expectedRaw = input.expectedRefunded;
  const owedRefund: NewRefundRecord | null =
    refundCents !== null && refundCents > 0 && deps.payments && /^\d+$/.test(expectedRaw)
      ? {
          id: asId<"RefundRecordId">(`rr_${randomUUID()}`),
          reservationId,
          reason: "operator_cancel",
          actorKind: "admin",
          actorId: adminId,
          askedCents: refundCents,
          ...(quotedCents !== null ? { quotedCents } : {}),
          expectedRefundedCents: Number(expectedRaw),
          createdAt: deps.now(),
        }
      : null;

  let result: Awaited<ReturnType<typeof cancelReservation>>;
  try {
    // `by` is what the confirm asked and what the refund branched on; since #724 it is also
    // recorded on the reservation rather than surviving only as a refund figure.
    result = await cancelReservation(
      {
        repo: deps.repo,
        now: deps.now,
        // A cancel collapses the shift, and the crew on it have to be TOLD (DEC-084/#244).
        // This is the notice that matters most in the whole product: without it a confirmed
        // crew member drives to a boat that is not sailing.
        ...(deps.relayFormNotices ? { relayFormNotices: deps.relayFormNotices } : {}),
        // Used by an unpaid phone booking (which `cancelReservation` hands on) and by a booked
        // booking's balance intent (issue #1254).
        payments: deps.payments,
      },
      reservationId,
      by,
      ...(owedRefund ? [owedRefund] : []),
    );
  } catch (e) {
    // The write that cancels the booking and frees its boat is one transaction, and everything after
    // it is best-effort and swallowed, so a throw here almost always means nothing changed. A connection
    // lost after the commit is the exception: the booking reads cancelled, and the refund box still works.
    logSwallowed("reservations:cancelByOperator", e, "the cancel threw — almost certainly nothing was cancelled");
    return { params: { cancelErr: "unreachable" }, draft: "stash" };
  }

  if (!result.ok) {
    // Nothing was cancelled, so the confirm screen comes back — with `by` reset to its first
    // option, which is a different refund quote than the one the operator picked. A booking with a
    // refund still being checked is refused by name (AC30): the record the cancel would owe is the
    // one thing the write cannot add.
    return {
      params: { cancelErr: result.reason === "refund_unfinished" ? "unfinished" : result.reason },
      draft: "stash",
    };
  }

  // **This press cancelled nothing** (PR #1214 review): the booking already was. It lost a race to
  // another press, which owns the cancel and its refund, so it stops here and tells nobody.
  if (result.alreadyCancelled) {
    return { params: { alreadyCancelled: "1" }, draft: "clear" };
  }

  // ── The trail: the boat is back on the market (issue #1048) ─────────────────
  //
  // **HERE, not after the refund**: emit ahead of every early return once the destructive thing has
  // happened. The cancel has committed by this line — the boat is free, the event is cancelled, the
  // crew have been told — and the exits below are all about the refund. An emit at the bottom would
  // record nothing for a cancel whose refund was refused, which is the case most worth having a
  // record of.
  //
  // A random id: an operator press has no redelivery, and a press that cancelled nothing has already
  // returned above.
  await recordTrail(trailDeps, {
    id: asId<"TrailEventId">(`cancelled:${randomUUID()}`),
    reservationId,
    actorKind: "admin",
    actorId: adminId,
    type: "cancelled",
    // `by` is the POLICY answer — whose fault the refund terms treat this as — and is what
    // `quoteCancelRefund` branches on. It is not the actor: an operator pressed this either
    // way, which `actorKind` and `actorId` already say.
    metadata: { reason: `cancelled by ${by}` },
  });

  // ── and refund, in the same press (operator, 2026-08-10) ────────────────────
  //
  // Ordering is deliberate: the cancellation is already committed above and is NOT rolled back if
  // the refund fails. Freeing the boat and telling the crew is the urgent half and it is correct
  // on its own; money that did not move can be moved on the next press, from a page that now
  // shows what is still owed. The reverse — refunding and then failing to cancel — would leave a
  // refunded customer holding a boat.
  if (!owedRefund) {
    if (refundCents === null || refundCents <= 0) {
      return cancelled({ cancelled: by }, "clear", noRefundSentNotice(quote));
    }
    if (!deps.payments) {
      return cancelled({ cancelled: by, refundErr: "stripe_not_configured" }, "stash", { kind: "pending" });
    }
    return cancelled({ cancelled: by, refundErr: "stale" }, "stash", { kind: "pending" });
  }
  // (`deps.payments` is present: it is what let the record be owed.)

  // The send tells the customer itself, once, claimed on the record (AC15): the notice carries the
  // outcome, and a press whose refund may or may not have moved tells nobody yet.
  const sent = await sendRefundRecord(
    {
      repo: deps.repo,
      payments: deps.payments!,
      now: deps.now,
      alert: deps.alert,
      ...(deps.tellCustomer ? { tellCustomer: deps.tellCustomer } : {}),
    },
    owedRefund.id,
    "press",
  );
  const withTold = (params: Record<string, string>): Record<string, string> =>
    "told" in sent && sent.told ? { ...params, told: sent.told } : params;

  if (sent.state === "whole") {
    return { params: withTold({ cancelled: by, refunded: String(sent.movedCents) }), draft: "clear" };
  }
  if (sent.state === "unknown") {
    // Whether it moved is not known, so this is never `unreachable` or `provider_error`: the record
    // is unfinished and the job asks Stripe.
    return { params: { cancelled: by, refundErr: "unknown" }, draft: "clear" };
  }
  if (sent.cause === "plan_refused") {
    // Nothing moved on these (`no_payment_intent`, a stale token), so the operator's figure still
    // stands and is worth keeping.
    return { params: withTold({ cancelled: by, refundErr: sent.reason }), draft: "stash" };
  }
  console.error(
    `[reservations] cancel+refund of ${owedRefund.askedCents}c on ${reservationId} failed partway ` +
      `(${sent.movedCents}c did move): ${sent.reason}`,
  );
  // CLEAR, not stash — the opposite of every other refusal here, and deliberately (#780).
  // Money may have PARTIALLY moved. Re-offering the figure the operator typed is the one thing this
  // screen's own copy tells them not to do ("retrying the full amount would refund that
  // {moved} twice"). Dropping the draft falls the box back to the recomputed refundable,
  // which already accounts for what went through.
  return {
    params: withTold({ cancelled: by, refundErr: "provider_error", refunded: String(sent.movedCents) }),
    draft: "clear",
  };
}
