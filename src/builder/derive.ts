/**
 * Pure derivation for the Shift Builder (SPEC §2.3, §1.1, DEC-005).
 *
 * Two pure functions, no I/O:
 *  - `deriveSeats` turns a vessel's manning list into required Seats — iterating
 *    the `{roleTypeId, count}` list for N roles (DEC-ROLE-1), never assuming a
 *    captain/mate pair. This is the graduation of the N-role sketch that lived in
 *    `brewboat.test.ts`.
 *  - `deriveShiftState` computes the Shift's crewing state from its seats
 *    (DEC-005: shift state is derived, never set directly; required seats gate
 *    `Crewed`, supernumeraries don't).
 */

import type { Event, Seat, Shift, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { ShiftId } from "../domain/ids.js";
import type { ShiftState } from "../domain/states.js";

/**
 * Required seats for a shift, derived by iterating the vessel's manning list.
 * One Open seat per manning unit; zero manning (e.g. a self-captained rental)
 * yields zero seats. Seat ids are deterministic so re-deriving is stable.
 */
export function deriveSeats(vessel: Vessel, shiftId: ShiftId): Seat[] {
  return vessel.manning.flatMap((m) =>
    Array.from({ length: m.count }, (_, i) => ({
      id: asId<"SeatId">(`seat-${shiftId}-${m.roleTypeId}-${i + 1}`),
      shiftId,
      role: m.roleTypeId,
      kind: "required" as const,
      state: "Open" as const,
    })),
  );
}

/**
 * Derive a shift's crewing state from its seats (DEC-005). Only **required**
 * seats gate `Crewed`; supernumerary seats are ignored here. A shift with no
 * required seats (a 0-crew vessel) is vacuously `Crewed` — nothing to fill.
 *
 * Precedence: a bailed required seat means the shift needs attention (`AtRisk`)
 * even if others are confirmed. `Completed`/`Cancelled` are lifecycle states set
 * elsewhere, not derived from seats.
 *
 * This function stays **seat-only and pure** (DEC-005). The time dimension —
 * horizon-based `Pending`→`Filling` birth and the time-driven `AtRisk` — is the
 * job of `resolveShiftState` below (the composition layer, DEC-022), never of
 * this fold. Per DEC-019 the 1.4b ask loop already makes `Bailed` transient:
 * `bail()` re-asks and advances the seat to `Asked` when candidates exist,
 * resting at `Bailed` (→ this `AtRisk` branch) only when the pool is exhausted —
 * so the pool half of the early-vs-late split is already encoded in the seat
 * states this fold reads. The remaining *time* half lands in `resolveShiftState`.
 */
export function deriveShiftState(seats: Seat[]): ShiftState {
  const required = seats.filter((s) => s.kind === "required");
  if (required.length === 0) return "Crewed";
  if (required.some((s) => s.state === "Bailed")) return "AtRisk";
  if (required.every((s) => s.state === "Confirmed")) return "Crewed";
  if (required.some((s) => s.state !== "Open")) return "Filling";
  return "Pending";
}

// ── Staffing-horizon clock (DEC-022) ─────────────────────────────────────────

/**
 * Default staffing-horizon lead, in **days** — how far ahead of the trip the
 * system starts working a shift (Pending→Filling). A dumb default; the value is
 * the tune-later knob (DEC-TBD "concrete horizon values"), DEC-022 fixes only
 * that it lives in one constant. NOT the same as the 45-min same-day manifest
 * call lead (DEC-021) — different lead, different purpose.
 */
export const STAFFING_HORIZON_LEAD_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant a single scheduled event "starts", from its `date` + `time`.
 * v1 simplification (DEC-022): clock times are treated as **UTC** — Muster
 * carries no timezone yet, and every other date in the core is ISO text handled
 * the same way. Revisit when vessel-local time matters operationally.
 */
function eventStart(e: Event): Date {
  return new Date(`${e.date}T${e.time}:00.000Z`);
}

/**
 * Staffing-horizon instant for a set of events — the earliest scheduled event
 * minus `leadDays`. Pure; derived, never stored (DEC-022). `null` when there's
 * no scheduled event to anchor to (a cancelled-out or empty group).
 */
export function staffingHorizonFromEvents(
  events: Event[],
  leadDays: number = STAFFING_HORIZON_LEAD_DAYS,
): Date | null {
  const scheduled = events.filter((e) => e.status === "scheduled");
  if (scheduled.length === 0) return null;
  const earliest = scheduled.reduce(
    (min, e) => Math.min(min, eventStart(e).getTime()),
    Infinity,
  );
  return new Date(earliest - leadDays * DAY_MS);
}

/** Staffing horizon for a shift, resolving its `eventIds` against `allEvents`. */
export function staffingHorizonFor(
  shift: Shift,
  allEvents: Event[],
  leadDays: number = STAFFING_HORIZON_LEAD_DAYS,
): Date | null {
  const ids = new Set(shift.eventIds);
  return staffingHorizonFromEvents(
    allEvents.filter((e) => ids.has(e.id)),
    leadDays,
  );
}

export interface HorizonContext {
  /** The scoring/decision instant — injected, never read from a clock (DEC-023). */
  now: Date;
  /** Precomputed staffing horizon (see `staffingHorizonFor`); `null` = no anchor. */
  horizon: Date | null;
  /**
   * Whether an unfilled required seat has an empty eligible pool — the "no one
   * left to ask" signal the caller derives from the oracle. The pool half of the
   * At-Risk condition (the time half is `now` vs `horizon`).
   */
  poolExhausted: boolean;
}

/**
 * Compose the seat-derived state with the time dimension (DEC-022). The pure
 * seat-fold `deriveShiftState` answers "given the seats, what state?"; this layer
 * overlays the horizon:
 *
 *  - A `Crewed` (filled) or `Cancelled` (lifecycle) shift is returned as-is — a
 *    booked-and-crewed trip doesn't un-crew because a clock ticked.
 *  - With no horizon anchor, fall back to the seat-fold (nothing to overlay).
 *  - **Before** the horizon the shift is `Pending` — booked, not yet worked,
 *    crew rules abstain (SPEC §1.1).
 *  - **After** the horizon it's actively worked: an exhausted pool (or an
 *    already-`AtRisk` seat-fold) means `AtRisk`; an all-Open shift is born into
 *    `Filling`; otherwise the seat-fold's own `Filling` stands.
 *
 * Pure: a function of (seats, now, horizon, poolExhausted), no I/O, no clock read.
 */
export function resolveShiftState(
  seats: Seat[],
  ctx: HorizonContext,
): ShiftState {
  const base = deriveShiftState(seats);
  if (base === "Crewed" || base === "Cancelled") return base;
  if (ctx.horizon === null) return base;
  if (ctx.now < ctx.horizon) return "Pending";
  if (base === "AtRisk" || ctx.poolExhausted) return "AtRisk";
  if (base === "Pending") return "Filling";
  return base;
}
