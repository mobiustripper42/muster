/**
 * Self-service cancellation from the manage page (16.9, issue #1074): a customer cancels their own
 * booking from `/b/<code>` and gets back what the published terms owe (`docs/SPEC.md §2.8.4c`), with
 * nobody at the operator having to act.
 *
 * **Offered only when the refund is more than $0.** Inside the window, or at a $0 refund, the page
 * keeps its "Request cancellation" form: cancelling there would end a trip for nothing, and the
 * operator's goodwill refund is a person's call (operator, 2026-10-23).
 *
 * **Cancel first, then refund** — the order the admin `cancelBooking` uses. The cancel frees the
 * boat and tells the crew; money that did not move can be sent by a person from the booking. **The
 * refund it owes is written in the cancel's own write** (issue #1278), so a cancel never commits with
 * its refund lost, and the press then sends that record. A cancel that ends unrefunded is never
 * silent: it writes a `refund_failed` row, texts the admins, and the caller emails the operator. A
 * refund that may or may not have moved reads `checking`, and the job finishes it.
 *
 * **Refused by name, never silently re-quoted** (DEC-197's posture). The page posts the figure it
 * showed (`quotedCents`) and the refunded-so-far token (`expectedRefundedCents`); if either no longer
 * matches, nothing is cancelled and the caller says so.
 *
 * Writes its own trail rows and sends no email to the operator: the server action owns that inbox.
 * The customer is told through `deps.tellCustomer` (issue #1212), once, from the press that
 * cancelled and after its refund leg, so the message can state the figure.
 */
import { randomUUID } from "node:crypto";
import { zonedWallClockToInstant } from "../config/tenant.js";
import type { FormResult } from "../builder/form-shifts.js";
import { isBooked, type Event, type NewRefundRecord, type Payment, type Reservation } from "../domain/entities.js";
import { asId, type ReservationId } from "../domain/ids.js";
import type { TrailEvent } from "../domain/reservation-trail.js";
import { logSwallowed } from "../log.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { hasDeparted } from "./availability.js";
import { insuranceOf } from "./booking-invoice.js";
import type { TellCustomer } from "./cancel-notice.js";
import { cancelReservation, quoteCancelRefund, type CancelOutcome } from "./cancel-reservation.js";
import { refundedTotalFor, sendRefundRecord } from "./refund-payment.js";
import { CANCELLATION_FEE_CENTS } from "./refund-terms.js";
import { recordTrail } from "./trail.js";

/** Stay on the same booking across a redirect. The code is the path, not a query pair. */
export function manageHref(code: string, extra?: Record<string, string>): string {
  const q = extra ? `?${new URLSearchParams(extra).toString()}` : "";
  return `/b/${encodeURIComponent(code)}${q}`;
}

export interface CustomerCancelQuote {
  /** Always more than 0. */
  refundCents: number;
  /** `refundedTotalFor(payments)` — the compare-and-swap token posted from the render. */
  expectedRefundedCents: number;
  /** Picks the confirm's copy line. */
  basis: "fee" | "insurance";
  /** The $50, or the insurance charged. */
  keptCents: number;
}

export type CancelRefund =
  | { kind: "issued"; cents: number }
  | { kind: "failed"; cents: number; movedCents: number }
  /** Whether the refund moved is not known yet (issue #1278): the job is asking Stripe. */
  | { kind: "checking"; cents: number };

export type CustomerCancelOutcome =
  | { ok: true; refund: CancelRefund }
  | {
      ok: false;
      reason:
        | "not_offered"
        | "already_cancelled"
        | "quote_changed"
        | "reservation_missing"
        /** The booking has a refund still being checked, so nothing was cancelled (AC30). */
        | "refund_unfinished";
      /** On `quote_changed`: above 0 re-confirms at the new figure, 0 means Cancel is closed. */
      newRefundCents?: number;
    };

/**
 * What cancelling would give back, or `null` when the page must not offer Cancel (AC3, AC4, AC9):
 * not a Muster booking, not booked, no event, already departed, or a refund of $0 or less. Pure.
 *
 * The figure comes from `quoteCancelRefund` — never re-derived — so the page, the action and the
 * operator's pane cannot quote one booking two ways.
 */
export function customerCancelQuote(input: {
  reservation: Reservation;
  event: Event | null;
  payments: readonly Payment[];
  now: Date;
}): CustomerCancelQuote | null {
  const { reservation, event, payments, now } = input;
  if (reservation.source !== "muster" || !isBooked(reservation) || !event) return null;
  if (hasDeparted(event.date, event.time, now.toISOString())) return null;

  const insurance = insuranceOf(reservation.invoice);
  const { refundCents } = quoteCancelRefund({
    by: "customer",
    payments,
    departureAt: zonedWallClockToInstant(event.date, event.time),
    now,
    insurance,
  });
  if (refundCents <= 0) return null;
  return {
    refundCents,
    expectedRefundedCents: refundedTotalFor(payments),
    basis: insurance ? "insurance" : "fee",
    keptCents: insurance ? insurance.chargedCents : CANCELLATION_FEE_CENTS,
  };
}

export interface CustomerCancelDeps {
  repo: Repository;
  now: () => string;
  payments: PaymentPort;
  /** Relay the re-form's crew notices, as the admin path does (AC12). */
  relayFormNotices?: (f: FormResult) => Promise<void>;
  /** Tell the customer it is cancelled and what is coming back (issue #1212). Optional, like
   *  `relayFormNotices`; absent tells nobody. */
  tellCustomer?: TellCustomer;
  /** Text every active admin, with a link when there is one (issue #1278): a refund that fell short. */
  alert: (message: string, href?: string) => Promise<void>;
}

const CANCEL_REASON = "cancelled by the customer from the booking page";

/**
 * Cancel the booking for its customer and refund what the terms owe.
 *
 * `posted` is what the confirm screen showed. Order: read, quote, compare, cancel (which writes the
 * refund record in the same save), trail, send the record. The record's own history row and the
 * customer's notice are written by the send (issue #1278).
 */
export async function cancelByCustomer(
  deps: CustomerCancelDeps,
  reservationId: ReservationId,
  posted: { quotedCents: number; expectedRefundedCents: number },
): Promise<CustomerCancelOutcome> {
  const reservation = await deps.repo.getReservation(reservationId);
  if (!reservation) return { ok: false, reason: "reservation_missing" };
  // Money is refunded only by the press that did the cancelling (AC7).
  if (reservation.status === "cancelled") return { ok: false, reason: "already_cancelled" };
  // A real confirm always posts a figure above 0; a post without one is malformed, whatever the
  // booking would quote.
  if (!Number.isInteger(posted.quotedCents) || posted.quotedCents <= 0) {
    return { ok: false, reason: "not_offered" };
  }

  const event = reservation.eventId ? await deps.repo.getEvent(reservation.eventId) : null;
  if (reservation.source !== "muster" || !isBooked(reservation) || !event) {
    return { ok: false, reason: "not_offered" };
  }

  const payments = await deps.repo.listPaymentsForReservation(reservationId);
  const quote = customerCancelQuote({ reservation, event, payments, now: new Date(deps.now()) });
  // The posted figure is what tells a stale page from a crafted post: it carried one above 0, so the
  // page was offering Cancel when it rendered.
  if (!quote) return { ok: false, reason: "quote_changed", newRefundCents: 0 };
  if (
    quote.refundCents !== posted.quotedCents ||
    quote.expectedRefundedCents !== posted.expectedRefundedCents
  ) {
    return { ok: false, reason: "quote_changed", newRefundCents: quote.refundCents };
  }

  // The refund this cancel owes, written in the cancel's own write (issue #1278, AC1).
  const owedRefund: NewRefundRecord = {
    id: asId<"RefundRecordId">(`rr_${randomUUID()}`),
    reservationId,
    reason: "customer_cancel",
    actorKind: "customer",
    askedCents: quote.refundCents,
    expectedRefundedCents: posted.expectedRefundedCents,
    createdAt: deps.now(),
  };

  let cancelled: CancelOutcome;
  try {
    cancelled = await cancelReservation(
      {
        repo: deps.repo,
        now: deps.now,
        // Issue #1254: cancels the booking's balance intent so it can no longer be paid.
        payments: deps.payments,
        ...(deps.relayFormNotices ? { relayFormNotices: deps.relayFormNotices } : {}),
      },
      reservationId,
      "customer",
      owedRefund,
    );
  } catch (e) {
    // A throw comes from the one write that cancels the booking and frees its boat, which can still
    // have committed (the connection dropped after it). If the booking is now cancelled, the write
    // landed whole: carry on to the trail row and the refund, or the customer is told "nothing
    // changed" about a booking that is cancelled and unrefunded. If not, nothing changed and the
    // throw is the caller's to report.
    const reread = await deps.repo
      .getReservation(reservationId)
      .catch((readErr: unknown) => {
        logSwallowed("reservations:cancelByCustomer", readErr, `could not re-read ${reservationId} after cancelReservation threw`);
        return null;
      });
    if (reread?.status !== "cancelled") throw e;
    logSwallowed("reservations:cancelByCustomer", e, `${reservationId} is cancelled but cancelReservation threw after the write`);
    cancelled = { ok: true, alreadyCancelled: false };
  }
  if (!cancelled.ok) {
    if (cancelled.reason === "refund_unfinished") return { ok: false, reason: "refund_unfinished" };
    return { ok: false, reason: cancelled.reason === "reservation_missing" ? "reservation_missing" : "not_offered" };
  }
  if (cancelled.alreadyCancelled) return { ok: false, reason: "already_cancelled" };

  // After the cancel has committed, before the refund can fail: a cancel whose refund was refused is
  // the case most worth having a record of.
  await recordTrail(deps, {
    id: asId<"TrailEventId">(`cancelled:${randomUUID()}`),
    reservationId,
    actorKind: "customer",
    type: "cancelled",
    metadata: { reason: CANCEL_REASON, quotedCents: quote.refundCents },
  });

  // Send the record the cancel wrote. The send writes the history row, tells the customer once and
  // texts the admins when it falls short; what is left here is what the page and the email say.
  const sent = await sendRefundRecord(
    {
      repo: deps.repo,
      payments: deps.payments,
      now: deps.now,
      alert: deps.alert,
      ...(deps.tellCustomer ? { tellCustomer: deps.tellCustomer } : {}),
    },
    owedRefund.id,
    "press",
  );
  if (sent.state === "whole") return { ok: true, refund: { kind: "issued", cents: quote.refundCents } };
  if (sent.state === "short") {
    console.error(
      `[reservations] customer refund of ${quote.refundCents}c on ${reservationId} fell short ` +
        `(${sent.movedCents}c did move): ${sent.reason}`,
    );
    return { ok: true, refund: { kind: "failed", cents: quote.refundCents, movedCents: sent.movedCents } };
  }
  // Unknown: the refund may have moved, so the customer is told nothing yet and the job decides.
  return { ok: true, refund: { kind: "checking", cents: quote.refundCents } };
}

/**
 * Which cancelled-page notice shows, and its figure, read from the booking's trail (oldest first) —
 * never from the URL. `null` when there is no customer `cancelled` row.
 */
export function cancelledNoticeFrom(
  rows: readonly TrailEvent[],
): { kind: "issued"; cents: number } | { kind: "failed"; cents: number; movedCents: number } | null {
  let cancelledAt = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.type === "cancelled" && row.actorKind === "customer" && typeof row.metadata.quotedCents === "number") {
      cancelledAt = i;
      break;
    }
  }
  if (cancelledAt < 0) return null;
  const cents = rows[cancelledAt]!.metadata.quotedCents!;

  // Failed while the last `refund_failed` after the cancel is unsettled. The operator refunding from
  // the booking settles it. A provider `refunded` row settles it only when that failure moved
  // nothing: after a PARTIAL failure, the `refunded` row is the webhook for the part that went
  // through, and settling on it told the customer the whole figure was on its way (PR #1214 review).
  // Only the customer's own failure counts: an operator attempt that fails afterwards is that
  // attempt's fact, and its `actualCents` is not what the customer's leg moved (@code-review).
  let failed: TrailEvent | null = null;
  let settled = false;
  for (let i = cancelledAt + 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.type === "refund_failed" && row.actorKind === "customer") {
      failed = row;
      settled = false;
    } else if (failed && row.type === "refund_issued_by_operator") {
      settled = true;
    } else if (failed && row.type === "refunded" && (failed.metadata.actualCents ?? 0) === 0) {
      settled = true;
    }
  }
  if (!failed || settled) return { kind: "issued", cents };
  return { kind: "failed", cents, movedCents: failed.metadata.actualCents ?? 0 };
}

/**
 * What the terms still owe after a customer's own cancel, from its trail, or `null` when there is no
 * customer cancel (an operator's cancel; nothing to say). The operator's refund box starts here
 * rather than at everything Stripe could give back, which after a customer cancel includes the $50 or
 * the insurance the terms keep — one press from the cancel email (PR #1214 review).
 */
export function owedAfterCustomerCancel(rows: readonly TrailEvent[]): number | null {
  const notice = cancelledNoticeFrom(rows);
  if (!notice) return null;
  return notice.kind === "failed" ? notice.cents - notice.movedCents : 0;
}

/**
 * Where the manage page goes after the action: the outcome as a URL. Params carry codes only, never
 * a figure (`.claude/CLAUDE-context.md` § Error Handling) — the page reads the figure from the trail.
 */
export function manageRedirectFor(code: string, outcome: CustomerCancelOutcome): string {
  if (outcome.ok) return manageHref(code, { cancelled: "1", refund: outcome.refund.kind });
  switch (outcome.reason) {
    case "quote_changed":
      return (outcome.newRefundCents ?? 0) > 0
        ? manageHref(code, { cancel: "1", error: "cancel_changed" })
        : manageHref(code, { error: "cancel_closed" });
    case "already_cancelled":
      return manageHref(code);
    default:
      return manageHref(code, { error: "cancel_failed" });
  }
}
