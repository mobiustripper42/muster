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
import { TENANT_TIMEZONE, zonedWallClockToInstant } from "../config/tenant.js";

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
 * The instant a single scheduled event "starts", from its vessel-local `date` +
 * `time`. Per **DEC-032** the wall-clock is interpreted in the vessel timezone
 * (`tz`, default `TENANT_TIMEZONE`) — DST-correct — so all downstream math
 * against a real `now` is right. (Supersedes DEC-022's "treat as UTC" v1
 * simplification; pass `tz: "UTC"` to recover the old behaviour, which the engine
 * tests do to keep fixtures deterministic.)
 */
function eventStart(e: Event, tz: string = TENANT_TIMEZONE): Date {
  return zonedWallClockToInstant(e.date, e.time, tz);
}

/**
 * The earliest scheduled departure among `events` — the instant the horizon
 * anchors to, and the "trip start" the At-Risk board counts down to (#41).
 * `null` when there's no scheduled event (a cancelled-out or empty group).
 */
export function earliestScheduledStart(
  events: Event[],
  tz: string = TENANT_TIMEZONE,
): Date | null {
  const scheduled = events.filter((e) => e.status === "scheduled");
  if (scheduled.length === 0) return null;
  const earliest = scheduled.reduce(
    (min, e) => Math.min(min, eventStart(e, tz).getTime()),
    Infinity,
  );
  return new Date(earliest);
}

/**
 * Every scheduled departure among `events`, earliest first — the trip times a
 * multi-trip shift runs in a day (#59). `earliestScheduledStart` is `[0]` of
 * this; the board renders the whole list so a two-trip day shows both, not just
 * the first departure. Empty when nothing is scheduled.
 */
export function scheduledStarts(
  events: Event[],
  tz: string = TENANT_TIMEZONE,
): Date[] {
  return events
    .filter((e) => e.status === "scheduled")
    .map((e) => eventStart(e, tz))
    .sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Staffing-horizon instant for a set of events — the earliest scheduled event
 * minus `leadDays`. Pure; derived, never stored (DEC-022). `null` when there's
 * no scheduled event to anchor to (a cancelled-out or empty group).
 */
export function staffingHorizonFromEvents(
  events: Event[],
  leadDays: number = STAFFING_HORIZON_LEAD_DAYS,
  tz: string = TENANT_TIMEZONE,
): Date | null {
  const start = earliestScheduledStart(events, tz);
  if (start === null) return null;
  return new Date(start.getTime() - leadDays * DAY_MS);
}

/** Staffing horizon for a shift, resolving its `eventIds` against `allEvents`. */
export function staffingHorizonFor(
  shift: Shift,
  allEvents: Event[],
  leadDays: number = STAFFING_HORIZON_LEAD_DAYS,
  tz: string = TENANT_TIMEZONE,
): Date | null {
  const ids = new Set(shift.eventIds);
  return staffingHorizonFromEvents(
    allEvents.filter((e) => ids.has(e.id)),
    leadDays,
    tz,
  );
}

// ── Fill deadline ("fills by", DEC-031) ──────────────────────────────────────

/**
 * Default fill-deadline lead, in **hours** before the trip — the moment an
 * unfilled shift stops being the engine's problem and becomes a human one
 * (SPEC §2.4/§2.5 "fills by"). This is the **same instant** the At-Risk board
 * boards a willingness-exhausted shift on (`at-risk-board` re-exports this as
 * `EXHAUSTED_THRESHOLD_HOURS`), by design (DEC-031): the displayed deadline IS
 * the escalation instant, so the two can't drift. Distinct from — and the
 * *closing* counterpart to — the staffing horizon, which is the window's
 * *opening* (Pending→Filling, DEC-022). Tune-later code constant; tenant-config
 * later, like `STAFFING_HORIZON_LEAD_DAYS`.
 */
export const FILL_DEADLINE_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;

/**
 * The fill deadline for a set of events — the earliest scheduled departure minus
 * `hours`. Pure; derived, never stored (DEC-031, DEC-022's rationale verbatim —
 * a stored deadline goes stale when events reschedule). `null` when no scheduled
 * event anchors the shift; rendered as absence, never faked (the P3 line).
 * Returns a past instant when the deadline has passed — callers render that
 * honestly as overdue, never clamped (a willingness-exhausted shift boards only
 * *after* this passes, by construction).
 */
export function fillDeadlineFromEvents(
  events: Event[],
  hours: number = FILL_DEADLINE_HOURS,
  tz: string = TENANT_TIMEZONE,
): Date | null {
  const start = earliestScheduledStart(events, tz);
  if (start === null) return null;
  return new Date(start.getTime() - hours * HOUR_MS);
}

/** Fill deadline for a shift, resolving its `eventIds` against `allEvents`. */
export function fillDeadlineFor(
  shift: Shift,
  allEvents: Event[],
  hours: number = FILL_DEADLINE_HOURS,
  tz: string = TENANT_TIMEZONE,
): Date | null {
  const ids = new Set(shift.eventIds);
  return fillDeadlineFromEvents(
    allEvents.filter((e) => ids.has(e.id)),
    hours,
    tz,
  );
}

/**
 * Bail lateness (DEC-028): the **notice shortfall versus the staffing-horizon
 * lead, clamped to it** — `clamp(leadMs − (tripStart − now), 0, leadMs)`.
 *
 *  - Bail with ≥ `leadDays` notice → 0: full notice, the flat `shift_bailed`
 *    weight is the whole penalty (SPEC §1.4 — "a cancel a week out is cheap").
 *  - Bail at departure → `leadMs`: the maximum. Lateness means "how far inside
 *    the window the system needed to refill" — same constant as DEC-022, on
 *    purpose.
 *  - Clamped past departure: a post-departure report is `no_show` territory
 *    (separate event, its own weight) and a stale admin report must not
 *    penalize by report latency.
 *  - `tripStart === null` → 0: no anchor, nothing to be late against.
 *
 * Computed **server-side at bail time** from the shift's events — never
 * client-supplied. Callers should log the raw signed notice
 * (`tripStart − now`) alongside (DEC-008: the derived value bakes in today's
 * `leadDays`; history must stay re-derivable).
 */
export function bailLatenessMs(
  tripStart: Date | null,
  now: Date,
  leadDays: number = STAFFING_HORIZON_LEAD_DAYS,
): number {
  if (tripStart === null) return 0;
  const leadMs = leadDays * DAY_MS;
  const noticeMs = tripStart.getTime() - now.getTime();
  return Math.min(leadMs, Math.max(0, leadMs - noticeMs));
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
