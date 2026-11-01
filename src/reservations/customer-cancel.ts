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
 * boat and tells the crew; money that did not move can be sent by a person from the booking. A
 * cancel that ends unrefunded is never silent: it writes a `refund_failed` row and the caller emails
 * the operator.
 *
 * **Refused by name, never silently re-quoted** (DEC-197's posture). The page posts the figure it
 * showed (`quotedCents`) and the refunded-so-far token (`expectedRefundedCents`); if either no longer
 * matches, nothing is cancelled and the caller says so.
 *
 * Writes its own trail rows and sends no email: the server action owns the inbox.
 */
import { randomUUID } from "node:crypto";
import { zonedWallClockToInstant } from "../config/tenant.js";
import type { FormResult } from "../builder/form-shifts.js";
import { isBooked, type Event, type Payment, type Reservation } from "../domain/entities.js";
import { asId, type ReservationId } from "../domain/ids.js";
import type { TrailEvent } from "../domain/reservation-trail.js";
import { logSwallowed } from "../log.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { hasDeparted } from "./availability.js";
import { insuranceOf } from "./booking-invoice.js";
import { cancelReservation, quoteCancelRefund, type CancelOutcome } from "./cancel-reservation.js";
import { refundedTotalFor, refundReservation, type RefundOutcome } from "./refund-payment.js";
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
  | { kind: "failed"; cents: number; movedCents: number };

export type CustomerCancelOutcome =
  | { ok: true; refund: CancelRefund }
  | {
      ok: false;
      reason: "not_offered" | "already_cancelled" | "quote_changed" | "reservation_missing";
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
}

const CANCEL_REASON = "cancelled by the customer from the booking page";

/**
 * Cancel the booking for its customer and refund what the terms owe.
 *
 * `posted` is what the confirm screen showed. Order: read, quote, compare, cancel, trail, refund,
 * trail on a failed refund — each trail write after the thing it records has committed and outside
 * the refund lease (`trail.ts`).
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

  let cancelled: CancelOutcome;
  try {
    cancelled = await cancelReservation(
      {
        repo: deps.repo,
        now: deps.now,
        ...(deps.relayFormNotices ? { relayFormNotices: deps.relayFormNotices } : {}),
      },
      reservationId,
      "customer",
    );
  } catch (e) {
    // `cancelReservation` writes the status and can still throw after it (releasing the hull). If the
    // booking is now cancelled the cancel committed: carry on to the trail row and the refund, or the
    // customer is told "nothing changed" about a booking that is cancelled and unrefunded. If not,
    // nothing changed and the throw is the caller's to report.
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

  const refunded = await refundAfterCancel(deps, reservationId, quote, posted.expectedRefundedCents);
  if (refunded.kind === "issued") return { ok: true, refund: refunded };
  if (refunded.kind === "other_press") return { ok: false, reason: "already_cancelled" };

  await recordTrail(deps, {
    // A fresh id per attempt: an operator or customer press has no redelivery, and two failures are
    // two facts.
    id: asId<"TrailEventId">(`refund_failed:${reservationId}:${randomUUID()}`),
    reservationId,
    actorKind: "customer",
    type: "refund_failed",
    metadata: { actualCents: refunded.movedCents, reason: refunded.reason },
  });
  return { ok: true, refund: { kind: "failed", cents: quote.refundCents, movedCents: refunded.movedCents } };
}

type RefundAttempt =
  | { kind: "issued"; cents: number }
  | { kind: "failed"; movedCents: number; reason: string }
  /** `stale`, and another press had already refunded the figure while this one waited. */
  | { kind: "other_press" };

/**
 * The refund leg. Never throws: the cancel has committed, so a thrown error is a failed refund —
 * the action's `cancel_failed` copy says "Nothing changed", which would be false now.
 */
async function refundAfterCancel(
  deps: CustomerCancelDeps,
  reservationId: ReservationId,
  quote: CustomerCancelQuote,
  expectedRefundedCents: number,
): Promise<RefundAttempt> {
  let result: RefundOutcome;
  try {
    result = await refundReservation(
      { repo: deps.repo, payments: deps.payments, now: deps.now },
      reservationId,
      quote.refundCents,
      expectedRefundedCents,
    );
  } catch (e) {
    logSwallowed("reservations:cancelByCustomer", e, `${reservationId} is cancelled but its refund threw`);
    return { kind: "failed", movedCents: 0, reason: e instanceof Error ? e.message : String(e) };
  }
  if (result.ok) return { kind: "issued", cents: quote.refundCents };

  if (result.reason === "stale" && (await refundedSince(deps, reservationId, expectedRefundedCents)) >= quote.refundCents) {
    return { kind: "other_press" };
  }
  if (result.reason === "provider_error") {
    console.error(
      `[reservations] customer refund of ${quote.refundCents}c on ${reservationId} failed partway ` +
        `(${result.refundedCents}c did move): ${result.message}`,
    );
    return { kind: "failed", movedCents: result.refundedCents, reason: result.message };
  }
  return { kind: "failed", movedCents: 0, reason: result.reason };
}

/** How much has gone back on this booking since `expectedRefundedCents`; 0 when it can't be read. */
async function refundedSince(
  deps: CustomerCancelDeps,
  reservationId: ReservationId,
  expectedRefundedCents: number,
): Promise<number> {
  try {
    return refundedTotalFor(await deps.repo.listPaymentsForReservation(reservationId)) - expectedRefundedCents;
  } catch (e) {
    logSwallowed("reservations:cancelByCustomer", e, `could not re-read ${reservationId}'s payments after a stale refund`);
    return 0;
  }
}

/**
 * Which cancelled-page notice shows, and its figure, read from the booking's trail (oldest first) —
 * never from the URL. `null` when there is no customer `cancelled` row.
 */
export function cancelledNoticeFrom(
  rows: readonly TrailEvent[],
): { kind: "issued" | "failed"; cents: number } | null {
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

  // Failed only while the last `refund_failed` after the cancel has no `refunded` row after it.
  let lastFailed = -1;
  let lastRefunded = -1;
  for (let i = cancelledAt + 1; i < rows.length; i++) {
    if (rows[i]!.type === "refund_failed") lastFailed = i;
    else if (rows[i]!.type === "refunded") lastRefunded = i;
  }
  return { kind: lastFailed > lastRefunded ? "failed" : "issued", cents };
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
