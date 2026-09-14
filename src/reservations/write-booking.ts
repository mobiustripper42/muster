/**
 * The booking write (SPEC §2.8.6, DEC-109/125) — the correctness hinge for Muster-native
 * reservations. `confirmReservation(paymentId)` finds the `pending` row checkout wrote before
 * Stripe (14.4), then **flips that row to `booked`** under the hull-day lock: the row's id, its
 * frozen money and both durations are the booking's for life. The Event is materialized at
 * confirm; before that there is nothing to point at (§2.8.2).
 *
 * **One write path, and it is a flip, not an insert.** The 11.3 `writeBooking` (row-locking a
 * seeded Event) was retired at #693; the 12.5 `writeSlotBooking` (building a booking from Stripe
 * metadata and inserting a fresh row) was retired at 14.5 (issue #916). A second way to write a
 * booking is a second place every future money rule has to land, and the path nothing exercises
 * is the one that quietly misses the next guard. Now the row checkout already wrote is the only
 * thing that becomes a booking.
 *
 * **Provider-agnostic.** Idempotency is the payment-intent id recorded on the row: a redelivered
 * webhook finds the row already `booked` and resolves `already`. The reservation id is no longer
 * derived from the payment id (that derivation, `sha256(idempotencyKey)`, went with the insert),
 * so two payment ids can resolve to one reservation — which is what §2.8.7's late-success rows
 * need (audit §Criterion 12, Phase 15.2). Nothing here imports Stripe.
 */
import type { Event, Reservation } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import { eventIdForSlot } from "./availability.js";
import { pendingLiveSince } from "./pending.js";
import { resolveCustomerId } from "../customers/resolve.js";


export type ConfirmResult =
  | { outcome: "booked"; reservation: Reservation }
  | { outcome: "already"; reservation: Reservation }
  // `lost` carries the row, and can: the hull went to a rival, but OUR row was read at the top of
  // `confirmPendingRow` and is still `pending` — the CAS touched somebody else's. The residual-race
  // compensation needs the customer's name, phone and email, and after 15.7 the charge carries
  // none of them. This is the only place they exist.
  | { outcome: "lost"; reservation: Reservation }
  // The pending row is not there to flip. `no_row`: checkout's write never landed, or this
  // charge was never one of ours — §2.8.6's paid-but-unbooked alert, and 2.8.9's reconciler
  // fallback. `not_pending`: the row is cancelled — a payment must never resurrect it.
  | { outcome: "unconfirmable"; reason: "no_row" | "not_pending" };

/**
 * Confirm the pending row that carries `paymentIntentId` (§2.8.6). Idempotent: a second run over
 * an already-`booked` row resolves `already`. `now` is injected (house style) for a deterministic
 * `updatedAt`.
 *
 * **The Event is built entirely from the ROW (15.6).** Slot, capacity from the vessel COI, trip
 * time frozen at checkout, and — as of this task — the price and extras from the row's frozen
 * `invoice`. `price` used to arrive from the succeeded intent's Stripe metadata, which DEC-164
 * and SPEC 2.8's negative list both forbid: "No booking assembled from data Stripe hands back."
 *
 * The parameter that carried those numbers is gone rather than merely unread, so there is no
 * longer a shape through which a Stripe number could reach this write. A payment intent id is
 * all a confirm is told.
 */
export async function confirmPendingRow(
  repo: Repository,
  paymentIntentId: string,
  now: () => string,
): Promise<ConfirmResult> {
  const row = await repo.getReservationByPaymentIntentId(paymentIntentId);
  if (!row) return { outcome: "unconfirmable", reason: "no_row" };
  // Already flipped — a redelivered webhook, or the success page after the webhook. The intent
  // id on the booked row is the idempotency key now that the reservation id is not derived.
  if (row.status === "booked") return { outcome: "already", reservation: row };
  if (row.status !== "pending") return { outcome: "unconfirmable", reason: "not_pending" };

  if (
    row.vesselId === undefined ||
    row.date === undefined ||
    row.time === undefined ||
    row.invoice === undefined
  ) {
    // A pending row names its slot and carries its frozen invoice (14.4, DEC-164). One without
    // either is a write bug, not a state — refuse it the way a charge with no row is refused
    // rather than materialize an Event at `undefined`.
    //
    // The invoice joins this guard in 15.6 rather than getting its own outcome: the condition is
    // identical (the checkout writes both, together, before Stripe is called), and a second
    // refusal reason would need its own alert body to say the same thing.
    return { outcome: "unconfirmable", reason: "no_row" };
  }

  const vessel = await repo.getVessel(row.vesselId);
  const eventId = eventIdForSlot(row.vesselId, row.date, row.time);
  const durationMinutes = row.tripMinutes;
  const candidateEvent: Event = {
    id: eventId,
    vesselId: row.vesselId,
    date: row.date,
    time: row.time,
    // The whole-boat COI cap is the party ceiling (DEC-108/109); fall back to the party size
    // only if the vessel row is missing (config error, not a race).
    capacity: vessel?.coiMaxPax ?? row.partySize,
    status: "scheduled",
    source: "muster",
    // The fare the customer was quoted, off the row's own frozen invoice (15.6, DEC-164).
    price: row.invoice.fareCents,
    // Trip time FROZEN off the row (DEC-161) — read from the offering when checkout STARTED,
    // which is the moment the customer's quote was fixed; a mid-checkout edit must not change
    // how long the trip that already ran was. Downstream this sets the shift's end.
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
  };

  // Resolve/create the customer at confirm (§2.8.6 step 4) — get-or-create by canonical phone,
  // the DEC-132 race settled by the database.
  const customerId = await resolveCustomerId(
    repo,
    { customerName: row.customerName, phone: row.phone, email: row.email },
    now,
  );

  const patch = {
    updatedAt: now(),
    ...(customerId !== undefined ? { customerId } : {}),
    // Extras off the invoice too — the deposit-mode balance deriver collects them, so the number
    // has to be the one the customer was quoted rather than one Stripe echoed back.
    extrasCents: row.invoice.extrasCents,
  };

  const res = await repo.bookPendingIfHullFree(
    row.id,
    candidateEvent,
    patch,
    pendingLiveSince(now()),
  );
  // Nothing to release: the flip turned the row that occupied this hull into the booking that
  // occupies it, so there is no second occupancy record to clean up. Until 14.7 there was — a
  // `checkout_holds` row that had to be deleted here or the boat stayed parked for the rest of
  // the window.
  if (res.result === "won") return { outcome: "booked", reservation: res.reservation };
  if (res.result === "already") return { outcome: "already", reservation: res.reservation };
  return { outcome: "lost", reservation: row };
}

/** The fields a confirm sets on the pending row as it flips it. Everything else was frozen at
 *  checkout (14.4) and is left exactly as the row carries it. */
export type ConfirmPatch = {
  updatedAt: string;
  customerId?: Reservation["customerId"];
  extrasCents?: number;
};
