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
import type { CancelledBy } from "../domain/entities.js";
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
import { refundReservation } from "./refund-payment.js";
import { recordTrail } from "./trail.js";

export interface OperatorCancelDeps {
  repo: Repository;
  now: () => string;
  /** Absent is the deploy with no Stripe keys, and reports `stripe_not_configured`. */
  payments?: PaymentPort;
  /** A cancel collapses the shift, and the crew on it have to be TOLD (DEC-084/#244). */
  relayFormNotices?: (f: FormResult) => Promise<void>;
  tellCustomer?: TellCustomer;
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
 * Writes the reservation AND its event to `cancelled`, which is what actually frees the boat. See
 * `cancelReservation` for why both. Never rejects.
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
        // Only used if this is an unpaid phone booking, which `cancelReservation` hands on.
        payments: deps.payments,
      },
      reservationId,
      by,
    );
  } catch (e) {
    // A throw here may land anywhere in that sequence: the crew may or may not have been told.
    logSwallowed("reservations:cancelByOperator", e, "the cancel did not complete — crew may or may not have been told");
    return { params: { cancelErr: "unreachable" }, draft: "stash" };
  }

  if (!result.ok) {
    // Nothing was cancelled, so the confirm screen comes back — with `by` reset to its first
    // option, which is a different refund quote than the one the operator picked.
    return { params: { cancelErr: result.reason }, draft: "stash" };
  }

  // **This press cancelled nothing** (PR #1214 review): the booking already was. Either it is the
  // "Release the boat" repair, or it lost a race to another press, which owns the cancel and its
  // refund. Both stop here, and neither tells the customer. `released=1` only when THIS press freed
  // the boat; a race's loser cannot know whether the winner's release finished.
  if (result.alreadyCancelled) {
    if (result.releaseFailed) return { params: { cancelErr: "not_released" }, draft: "clear" };
    return { params: { released: result.freedEventId ? "1" : "0" }, draft: "clear" };
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

  // **The cancel committed but its boat was not released** (PR #1214 review): releasing threw, so the
  // event still holds the hull and the crew were not told. The cancel is recorded just above — this
  // is the press that made it, and the repair press records nothing. The refund waits for the
  // operator: `cancelled` keeps the reason the box prefills from, and the stashed draft keeps the
  // figure they typed. No figure has been read at this exit, so the customer hears that a refund is
  // still to come, even on a booking with nothing refundable.
  if (result.releaseFailed) {
    return cancelled({ cancelled: by, cancelErr: "not_released" }, "stash", { kind: "pending" });
  }

  // ── and refund, in the same press (operator, 2026-08-10) ────────────────────
  //
  // **The amount is computed HERE when the box is blank**, from the reason actually posted. That
  // is not a convenience, it is the correctness argument for the whole design: with no client JS
  // a prefilled box cannot follow the radio, so a prefill would let "We cancelled" refund at the
  // customer rate whenever the operator didn't retype. A blank box has no wrong value to carry.
  //
  // Ordering is deliberate: the cancellation is already committed above and is NOT rolled back if
  // the refund fails. Freeing the boat and telling the crew is the urgent half and it is correct
  // on its own; money that did not move can be moved on the next press, from a page that now
  // shows what is still owed. The reverse — refunding and then failing to cancel — would leave a
  // refunded customer holding a boat.
  const typed = input.typedAmount.trim();

  // The published-terms figure, computed on BOTH paths. It is the refund amount when the operator
  // typed nothing, and the COMPARISON when they did — `refund_issued_by_operator` carries it so the
  // delta is readable later without recomputing terms that may since have changed (issue #1050).
  //
  // No event ⇒ no departure instant ⇒ no notice window, so the figure cannot be derived at all.
  // Cancel stands; the operator refunds by hand from the box, and the trail row simply has no
  // `quotedCents` — which means "there was no policy figure", not "it matched". A failed read is
  // the same answer: `null`. The quote is kept whole so the notice can read what was paid.
  let quote: CancelQuote | null = null;
  try {
    const payments = await deps.repo.listPaymentsForReservation(reservationId);
    const event = result.freedEventId ? await deps.repo.getEvent(result.freedEventId) : null;
    const row = await deps.repo.getReservation(reservationId);
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

  let refundCents: number | null = null;
  if (typed === "") {
    refundCents = quotedCents;
  } else {
    const parsed = parseDollarsToCents(typed);
    // The cancel HAPPENED. A bad amount cannot undo it, so this reports the cancel as done and
    // the refund as not attempted — never a bare `invalid_amount` that reads like nothing ran.
    if (parsed === null) {
      // The cancel already COMMITTED, so the confirm screen this was typed on is gone — the
      // figure has to survive into the standalone refund box or it is lost. That box prefills,
      // so losing it shows a plausible WRONG number rather than an empty field (#780).
      return cancelled({ cancelled: by, refundErr: "invalid_amount" }, "stash", { kind: "pending" });
    }
    refundCents = parsed;
  }

  // Zero is a legitimate outcome, not a failure: inside the 14-day window the published terms owe
  // nothing, and the operator can type 0 to cancel without refunding.
  if (refundCents === null || refundCents <= 0) {
    return cancelled({ cancelled: by }, "clear", noRefundSentNotice(quote));
  }

  if (!deps.payments) {
    return cancelled({ cancelled: by, refundErr: "stripe_not_configured" }, "stash", { kind: "pending" });
  }
  const expectedRaw = input.expectedRefunded;
  if (!/^\d+$/.test(expectedRaw)) {
    return cancelled({ cancelled: by, refundErr: "stale" }, "stash", { kind: "pending" });
  }

  let refund: Awaited<ReturnType<typeof refundReservation>>;
  try {
    refund = await refundReservation(
      { repo: deps.repo, payments: deps.payments, now: deps.now },
      reservationId,
      refundCents,
      Number(expectedRaw),
    );
  } catch (e) {
    // Money path, and the ambiguous half: the booking may already be cancelled
    // while the refund is not, which is exactly what `cancelled: by` in the
    // redirect is admitting.
    logSwallowed("reservations:cancelByOperator", e, "the refund leg of cancel-and-refund did not complete");
    return cancelled({ cancelled: by, refundErr: "unreachable" }, "leave", { kind: "pending" });
  }

  if (!refund.ok) {
    if (refund.reason === "provider_error") {
      console.error(
        `[reservations] cancel+refund of ${refundCents}c on ${reservationId} failed partway ` +
          `(${refund.refundedCents}c did move): ${refund.message}`,
      );
      // The partial failure, recorded where the lease is already released (issue #1050).
      // `payments.refunded_cents` will show what moved and nothing else would ever say the
      // operator asked for more and did not get it.
      await recordTrail(trailDeps, {
        // **A fresh id per attempt, not a derived one** (`/security-review`). The CAS token
        // is the refunded TOTAL, and a `provider_error` that moved zero cents leaves it
        // unchanged — so two consecutive zero-movement failures derived the same id and the
        // second was dropped by `on conflict do nothing`. "It failed twice" is exactly the
        // fact an operator needs and it was the one being discarded.
        //
        // Determinism is a WEBHOOK property: it exists so a Stripe redelivery collides
        // instead of duplicating. An operator action has no redelivery, and a double-submit
        // writing two audit rows is the right failure direction for a log.
        id: asId<"TrailEventId">(`refund_failed:${reservationId}:${randomUUID()}`),
        reservationId,
        actorKind: "admin",
        actorId: adminId,
        type: "refund_failed",
        metadata: { actualCents: refund.refundedCents, reason: refund.message },
      });
      // CLEAR, not stash — the opposite of every other refusal here, and deliberately (#780).
      // Money PARTIALLY moved. Re-offering the figure the operator typed is the one thing this
      // screen's own copy tells them not to do ("retrying the full amount would refund that
      // {moved} twice"). Dropping the draft falls the box back to the recomputed refundable,
      // which already accounts for what went through.
      return cancelled(
        { cancelled: by, refundErr: "provider_error", refunded: String(refund.refundedCents) },
        "clear",
        refund.refundedCents > 0
          ? { kind: "partial", movedCents: refund.refundedCents, cents: refundCents }
          : { kind: "pending" },
      );
    }
    // Nothing moved on these (`no_payment_intent`, `not_muster`, …), so the operator's figure
    // still stands and is worth keeping.
    return cancelled({ cancelled: by, refundErr: refund.reason }, "stash", { kind: "pending" });
  }

  // The trail, AFTER the money moved and after the cancel committed — never before either
  // (issue #1050). `quotedCents` is present here and absent on the standalone refund box,
  // which is the whole reason this event is named for what the operator did rather than for
  // a comparison: on this path there IS a published-terms figure to compare against.
  await recordTrail(trailDeps, {
    // `expectedRaw` is the compare-and-swap token — the refunded total this screen was
    // rendered against — so it is stable across a retry of THIS operation and different for
    // every subsequent one. Keying on the amount alone collided: two $50 goodwill refunds on
    // one booking produced the same id and `on conflict do nothing` silently dropped the
    // second row, which is the one thing this table exists to prevent (`@code-review`).
    id: asId<"TrailEventId">(`refund_issued_by_operator:${reservationId}:${expectedRaw}`),
    reservationId,
    actorKind: "admin",
    actorId: adminId,
    type: "refund_issued_by_operator",
    metadata: {
      actualCents: refund.refundedCents,
      ...(quotedCents !== null ? { quotedCents } : {}),
      reason: "cancel-and-refund",
    },
  });
  return cancelled({ cancelled: by, refunded: String(refund.refundedCents) }, "clear", {
    kind: "issued",
    cents: refund.refundedCents,
  });
}
