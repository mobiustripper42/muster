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
 * A positive-integer env knob (days/hours/count) with a fallback. Non-integer or
 * non-positive overrides fall back rather than poison the default — a fat-fingered
 * value degrades to the sane constant instead of disabling the horizon.
 */
function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Like `envPositiveInt` but **accepts 0** — for knobs where 0 is a meaningful
 * "off", not an error (the drip interval: 0 = blast-all, no pacing).
 */
function envNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Staffing-horizon lead, in **days** — how far ahead of the trip the system
 * starts working a shift (Pending→Filling). The tune-later knob (DEC-TBD
 * "concrete horizon values", DEC-062): **env-overridable** via
 * `STAFFING_HORIZON_LEAD_DAYS` (positive integer days), default **7**. DEC-022
 * fixes only that it lives in one place; the value is the operator's (Eric's) to
 * tune per deploy without a code change. NOT the same as the 45-min same-day
 * manifest call lead (DEC-021) — different lead, different purpose.
 */
export const STAFFING_HORIZON_LEAD_DAYS = envPositiveInt(
  "STAFFING_HORIZON_LEAD_DAYS",
  7,
);

/**
 * Xola **pull-window** lead, in **days** — how far ahead the importer fetches
 * reservations from Xola (the `/orders` arrival window). **Decoupled** from
 * `STAFFING_HORIZON_LEAD_DAYS` (DEC-080): the operator can pull a month of
 * bookings to review without the engine starting to *ask* crew that far out —
 * shift-formation (Pending→Filling, and therefore the asks) still keys off the
 * staffing horizon, not this. Env-overridable via `XOLA_PULL_LEAD_DAYS`
 * (positive integer days); **defaults to `STAFFING_HORIZON_LEAD_DAYS`** so an
 * unset value reproduces the prior coupled behaviour exactly.
 */
export const XOLA_PULL_LEAD_DAYS = envPositiveInt(
  "XOLA_PULL_LEAD_DAYS",
  STAFFING_HORIZON_LEAD_DAYS,
);

/**
 * Tier-1 ask **drip** interval, in **minutes** (DEC-063). The engine seeds one ask
 * to the top-ranked candidate per seat, then widens by one more every interval
 * until someone accepts or the pool is walked — so the reliability ranking finally
 * drives *timing*, not just outbox display order. Env-overridable
 * (`ASK_DRIP_INTERVAL_MINUTES`), default **15** (aligned to the 15-minute tick
 * cadence — the floor on widen granularity). **`0` = blast the whole pool at once** (the
 * pre-drip behaviour, the rollback). Inside the fills-by deadline the tick blasts
 * regardless (urgency overrides pacing). NOT the Pass-D staged-*horizons*
 * reservation — that banks willingness across horizons; this paces wall-clock
 * asks at the single hard horizon.
 */
export const ASK_DRIP_INTERVAL_MINUTES = envNonNegativeInt(
  "ASK_DRIP_INTERVAL_MINUTES",
  15,
);

/**
 * How long an unanswered ask waits before it counts as **silent** (#151,
 * DEC-067) — the timeout the tick hands `expireAsks` each sweep. Past this, an
 * un-responded ask is stamped `ask_ignored` (the negative reliability signal,
 * DEC-008) and, if it was the seat's last live ask, the seat reopens so the drip
 * widens past the ghoster and Tier-2 can escalate. Env-overridable
 * (`ASK_SILENT_TIMEOUT_MINUTES`, positive int minutes), default **120** (2h) —
 * the operator's to tune per pilot, same posture as the drip/horizon knobs. NOT
 * zero-valued (a 0 timeout would expire every ask the instant it's sent), so it
 * uses `envPositiveInt`, not the drip's non-negative helper.
 */
export const ASK_SILENT_TIMEOUT_MINUTES = envPositiveInt(
  "ASK_SILENT_TIMEOUT_MINUTES",
  120,
);

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
 * boards an uncrewed shift on via route (b) (`at-risk-board` re-exports this as
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
 * honestly as overdue, never clamped (a route-(b) shift boards only once `now`
 * reaches this instant, by construction).
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

// ── Shift window: call lead + trip length (DEC-021, DEC-041) ──────────────────

const MINUTE_MS = 60 * 1000;

/**
 * Minutes a crew member must arrive before departure — the day-of manifest call
 * lead (DEC-021). FLAT, fleet-wide: a single number was the explicit ask. The
 * richer model (per-vessel prep + additive positioning/transit computed from
 * storage→dock) is parked in FUTURE_IDEAS; swap this constant for that resolver
 * when it lands. NOT the same lead as `STAFFING_HORIZON_LEAD_DAYS` /
 * `FILL_DEADLINE_HOURS` above — those are engine *days/hours* horizons; this is
 * the same-day clock lead. Lives here (not in the crew card) because the shift
 * *end* needs it too, and the outbox reads that end (DEC-041).
 */
export const CALL_LEAD_MINUTES = 45;

/**
 * Flat trip length in minutes — the (c) stopgap source for a trip's duration
 * (DEC-041), sibling to `CALL_LEAD_MINUTES`. There is no per-event duration in
 * the model yet (Xola exposes no length; no operator-config surface): until a
 * real source lands — Xola product duration (a) or an operator-set value (b) —
 * every trip is assumed this long. Swap this constant for `Event.durationMinutes`
 * when that field and its source arrive.
 */
export const TRIP_DURATION_MINUTES = 100;

/**
 * The latest scheduled departure among `events` — the trip that ends the shift.
 * Mirror of `earliestScheduledStart`; `null` when nothing is scheduled.
 */
export function latestScheduledStart(
  events: Event[],
  tz: string = TENANT_TIMEZONE,
): Date | null {
  const scheduled = events.filter((e) => e.status === "scheduled");
  if (scheduled.length === 0) return null;
  const latest = scheduled.reduce(
    (max, e) => Math.max(max, eventStart(e, tz).getTime()),
    -Infinity,
  );
  return new Date(latest);
}

/**
 * The instant a shift "ends" (DEC-041): the latest scheduled departure + the
 * trip length + the call lead reused as a post-trip teardown buffer ("report
 * time" is the same lead, applied symmetrically at both ends — not a new
 * constant). Pure; derived, never stored. `null` when no scheduled event
 * anchors the shift. With a flat trip length the latest *departure* yields the
 * latest *end*; when per-event durations land this becomes max(start+duration).
 */
export function shiftEndFromEvents(
  events: Event[],
  tz: string = TENANT_TIMEZONE,
): Date | null {
  const last = latestScheduledStart(events, tz);
  if (last === null) return null;
  return new Date(
    last.getTime() + (TRIP_DURATION_MINUTES + CALL_LEAD_MINUTES) * MINUTE_MS,
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
