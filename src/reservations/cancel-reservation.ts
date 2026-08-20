/**
 * Cancel a Muster-native booking (#616) — the operator action that did not exist. Nothing in
 * the product ever wrote `status: "cancelled"` on a reservation; the only `saveReservation`
 * caller was the Xola importer, and the customer-facing "cancel" on the `/b/<code>` manage page
 * composes an EMAIL and persists nothing (`manage/actions.ts:64`).
 *
 * **Cancelling writes TWO rows, and the second one is the point.** Marking the reservation
 * cancelled releases this slot for re-sale (the claim predicate filters `status='booked'`), but
 * the boat stays occupied for every OTHER departure that day: `hull-busy` and the overlap guard
 * in `saveBookingIfSlotFree` count any event whose status is `scheduled`, so a cancelled 13:30
 * booking keeps 14:00 unsellable on that hull. It also keeps the crew rostered — `formShifts`
 * collapses a shift to `Cancelled` only when EVERY event on the vessel-day has cancelled. So the
 * event is cancelled too, which is exactly what the importer does on the Xola side when a trip
 * loses its last live booking (`import-reservations.ts:226`).
 *
 * The re-sale that then has to keep working is not free: `events_muster_slot_identity` is
 * status-agnostic, so a cancelled row still owns its slot identity and would brick the slot
 * forever. `saveBookingIfSlotFree` resurrects it — see the comment there, and the Postgres test
 * that fails with `lost` without it.
 *
 * **This module moves no money.** Refunding is a separate, deliberate operator action
 * (`refund-payment.ts`) against a figure they can edit; `quoteCancelRefund` below only computes
 * what the published terms suggest, for the confirm screen to prefill.
 */
import { formShifts, type FormResult } from "../builder/form-shifts.js";
import { logFormAudit } from "../oracle/audit-log.js";
import type { CancelledBy, Payment } from "../domain/entities.js";
import type { EventId, ReservationId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { countsAsPaid } from "./payment-config.js";
import { operatorCancelRefundCents, refundOwedCents } from "./refund-terms.js";

/**
 * Who initiated the cancellation. **The discriminator the refund turns on** — not the notice
 * given — which is why `refund-terms.ts` keeps the two policies as separate functions rather
 * than one function with a flag. Weather at two hours' notice is a full refund; a customer
 * changing their mind at two hours' notice is nothing.
 *
 * Defined on `Reservation` since #724, because it is now persisted rather than only routed. This
 * re-export keeps the existing import sites working and keeps one definition.
 */
export type { CancelledBy };

export interface CancelQuoteInput {
  by: CancelledBy;
  /** The booking's payment rows (`listPaymentsForReservation`). */
  payments: readonly Payment[];
  /** True UTC instant of the departure — mint it through `zonedWallClockToInstant` (DEC-032),
   *  never by concatenating the vessel-local date and time into a `Date`. */
  departureAt: Date;
  now: Date;
  /** Flex insurance narrows the window to 72h. Unsellable today (#683) ⇒ effectively false. */
  hasFlex?: boolean;
}

export interface CancelQuote {
  by: CancelledBy;
  /** Refundable money the customer has actually paid — see `refundableCents`. */
  paidCents: number;
  /** Notice given. Negative past the departure (a no-show), which reads as zero refund. */
  hoursBeforeDeparture: number;
  /** What the published terms produce. **A PREFILL, not a decision** — the operator edits it. */
  refundCents: number;
}

/**
 * Refundable money on a booking: what was captured, minus what has already gone back, minus
 * the parts that are not the operator's to return.
 *
 * **Gratuity and the service fee are carved out** — the same carve-out `balanceOwedCents`
 * makes, for a sharper reason here. A tip is crew money (DEC-124), and a quote that included
 * it would hand crew pay back on a routine cancel with no human ever deciding to. The
 * asymmetry is deliberate: an operator who wants to return the tip types a bigger number and
 * has thought about it; an operator who accepts a default that was too high has not, and
 * cannot un-send it.
 */
function refundableCents(payments: readonly Payment[]): number {
  return payments.reduce((sum, p) => {
    // A fully refunded row contributes nothing whatever `refundedCents` says — it may be
    // absent on a hand-reconciled row, and trusting the amount alone would re-offer money
    // that is already gone. Status wins for the terminal state (`countsAsPaid`).
    if (!countsAsPaid(p)) return sum;
    const notOurs = (p.gratuityCents ?? 0) + (p.serviceFeeCents ?? 0);
    return sum + Math.max(0, p.amountCents - notOurs - (p.refundedCents ?? 0));
  }, 0);
}

const MS_PER_HOUR = 3_600_000;

/** What the published terms produce for this cancellation. Pure — no repo, no clock of its own. */
export function quoteCancelRefund(input: CancelQuoteInput): CancelQuote {
  const paidCents = refundableCents(input.payments);
  const hoursBeforeDeparture =
    (input.departureAt.getTime() - input.now.getTime()) / MS_PER_HOUR;
  const refundCents =
    input.by === "operator"
      ? operatorCancelRefundCents(paidCents)
      : refundOwedCents({
          paidCents,
          hoursBeforeDeparture,
          ...(input.hasFlex !== undefined ? { hasFlex: input.hasFlex } : {}),
        });
  return { by: input.by, paidCents, hoursBeforeDeparture, refundCents };
}

export interface CancelDeps {
  repo: Repository;
  now: () => string;
  /**
   * Relay a re-form's crew notices — "you're off" (`cancelledCrew`), DEC-084/#244. Injected
   * because the channel wiring lives in `app/`, the same seam the booking webhook uses.
   *
   * Cancelling is the case this matters most for: the whole point is that a crew member who
   * was confirmed on this boat stops turning up. Absent, the shift still collapses and the
   * audit row is still written — but nobody is told.
   */
  relayFormNotices?: (form: FormResult) => Promise<void>;
}

export type CancelOutcome =
  | {
      ok: true;
      /** True when the reservation was already cancelled — the call still repairs the event. */
      alreadyCancelled: boolean;
      /** The event cancelled, or absent when another active booking still holds it. */
      freedEventId?: EventId;
    }
  | { ok: false; reason: "reservation_missing" | "not_muster" };

/**
 * `by` is REQUIRED, not optional (#724). Every caller already knows the answer — the admin
 * confirm asks it to pick a refund policy — and an optional parameter is how a surface ends up
 * recording nothing while looking correct. It is written once and never rewritten; see
 * `Reservation.cancelledBy`.
 */
export async function cancelReservation(
  deps: CancelDeps,
  reservationId: ReservationId,
  by: CancelledBy,
): Promise<CancelOutcome> {
  const reservation = await deps.repo.getReservation(reservationId);
  if (!reservation) return { ok: false, reason: "reservation_missing" };
  // Xola owns its own bookings and its own money (DEC-105). Cancelling one here would be
  // overwritten by the next pull and would tell the customer nothing.
  if (reservation.source !== "muster") return { ok: false, reason: "not_muster" };

  const alreadyCancelled = reservation.status === "cancelled";
  if (!alreadyCancelled) {
    await deps.repo.saveReservation({
      ...reservation,
      status: "cancelled",
      cancelledBy: by,
      updatedAt: deps.now(),
    });
  }

  // **Deliberately NOT an early return on `alreadyCancelled`.** A crash between the two writes
  // leaves the reservation cancelled and the event scheduled — a boat silently un-released,
  // with the surface reading "Cancelled" and nothing to suggest otherwise. Re-running finishes
  // the job. That is only safe because every write below is idempotent.
  // Release the hull through the CONDITIONAL write, not a read-then-`saveEvent`.
  //
  // The obvious version — read the event, check nobody else holds it, write it cancelled — has
  // a real window, and code review caught it. Cancelling the reservation a few lines above frees
  // the slot *immediately* (the claim check filters `status='booked'`), so a new buyer can win
  // this exact slot between that read and this write. An unconditional `saveEvent` would then
  // cancel their live, paid booking, collapse the shift and tell the crew they are off a boat
  // somebody is on. `cancelEventIfUnclaimed` does the check and the write under the same
  // hull-day advisory lock the booking path takes, so the two serialize.
  const cancelledEvent = await deps.repo.cancelEventIfUnclaimed(reservation.eventId);
  const freedEventId: EventId | undefined = cancelledEvent ? reservation.eventId : undefined;

  // Re-form so the shift collapses and its crew are told. Best-effort by the same contract the
  // booking webhook uses: the cancellation is COMMITTED by this point, so a channel hiccup or
  // an audit failure must not throw back to the operator and make them press cancel again on a
  // booking that is already cancelled. The cron tick re-forms as the backstop.
  //
  // `notifyTripChanges: true` (#765): "the shift collapses and its crew are told" only covered
  // the case where the cancelled trip was the day's ONLY trip — that collapse emits
  // `cancelledCrew`, which is ungated. A day with other trips keeps a LIVE shift with a smaller
  // trip set, which lands in `changedCrew`, which was gated off. The crew member kept a shift
  // whose shape moved under them — plausibly a different call time — and heard nothing.
  try {
    const form = await formShifts(deps.repo, {
      now: new Date(deps.now()),
      notifyTripChanges: true,
    });
    try {
      await deps.relayFormNotices?.(form);
    } catch (e) {
      console.error("[reservations] cancel: form-notice relay failed — crew may not know", e);
    }
    try {
      // Actor `engine` matches the booking webhook's own audit posture: the re-form is a
      // derived consequence, not the operator's direct act on a seat.
      await logFormAudit(deps.repo, form, { kind: "engine" }, new Date(deps.now()));
    } catch (e) {
      console.error("[reservations] cancel: form audit failed — the transition is unrecorded", e);
    }
  } catch (e) {
    console.error(
      `[reservations] formShifts after cancelling ${reservationId} failed — the tick will re-form`,
      e,
    );
  }

  return {
    ok: true,
    alreadyCancelled,
    ...(freedEventId !== undefined ? { freedEventId } : {}),
  };
}
