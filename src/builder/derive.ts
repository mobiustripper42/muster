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
import {
  addDays,
  envWallClock,
  mondayZeroWeekday,
  TENANT_TIMEZONE,
  vesselDateOf,
  zonedWallClockToInstant,
} from "../config/tenant.js";

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
 * this fold. Since DEC-128 (#483) `bail()`/`vacateSeat()` fire no asks and rest
 * the seat **`Open`** — they never persist `Bailed` — so past-horizon At-Risk for
 * an exhausted pool now comes from `resolveShiftState(poolExhausted)`, not this
 * `Bailed` branch. The branch is **retained** for legacy seats that may still rest
 * `Bailed` in an existing store (they keep today's board/lean-rescue behavior);
 * no new writer produces one.
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
 * Like `envPositiveInt` but accepts a positive **fraction** — the horizon is
 * millisecond math (`start − leadDays·DAY_MS`), so a sub-day lead (e.g. `6.1` =
 * 6d 2.4h) is meaningful for landing the ask at a good hour vs. the trip's
 * clock time. Only `> 0` and finite; a garbage value still falls back.
 */
function envPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * A day-of-week env knob, **Mon=0 … Sun=6**, bounded `[0,6]`. `envPositiveInt`
 * won't do — it rejects the valid `0` (Monday) and has no upper bound. Garbage or
 * out-of-range degrades to `fallback` (poison-resistant, same as the other knobs).
 */
function envDayOfWeek(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : fallback;
}

/**
 * A **space-separated set** of weekdays (Mon=0 … Sun=6) — e.g. `"4 5 6"` = Fri Sat
 * Sun. Empty/unset → **empty set = weekend batching OFF** (flat behaviour, the
 * backward-compat / other-tenant default). Non-integer or out-of-range tokens are
 * dropped individually, so a fully-garbage value degrades to off rather than
 * throwing (a config throw kills the cron).
 */
function envDaySet(name: string): Set<number> {
  const out = new Set<number>();
  const raw = process.env[name];
  if (!raw) return out;
  for (const tok of raw.trim().split(/\s+/)) {
    const n = Number(tok);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n);
  }
  return out;
}

/**
 * Staffing-horizon lead, in **days** — how far ahead of the trip the system
 * starts working a shift (Pending→Filling). The tune-later knob (DEC-062):
 * **env-overridable** via `STAFFING_HORIZON_LEAD_DAYS`, a **positive number**
 * (fractional allowed — `6.1` = 6d 2.4h, to time the ask off the trip's clock
 * hour), default **7**. The value is the operator's to tune per deploy without a
 * code change. NOT the same as the 45-min same-day manifest call lead (DEC-021).
 */
export const STAFFING_HORIZON_LEAD_DAYS = envPositiveNumber(
  "STAFFING_HORIZON_LEAD_DAYS",
  7,
);

/**
 * Weekend-batch trigger policy (DEC-116) — extends DEC-088's "decouple ask
 * send-time from the trip's clock" from the hour axis to the day. A trip whose
 * vessel-local weekday ∈ `weekendDays` fires its asks on ONE shared instant —
 * that week's `triggerDay` at `askTime` — so all of Fri/Sat/Sun collapse onto a
 * single (e.g. Monday 09:00) send instead of each tripping its own flat lead.
 *
 * `STAFFING_HORIZON_WEEKEND_DAYS` empty/unset ⇒ **off** (flat behaviour,
 * unchanged). `STAFFING_HORIZON_LEAD_DAYS` keeps its name and is now "the
 * non-cohort lead" — every non-weekend trip-day still uses it. All three knobs are
 * env-overridable + poison-resistant. `triggerDay` values 1–5 walk into the prior
 * week (`(7−triggerDay)%7` days before that Monday) — only `0` (Mon) and `6` (the
 * Sun before) are sensible; documented, not enforced.
 */
export interface WeekendCohortPolicy {
  /** Mon=0 … Sun=6 trip-days that use the shared trigger. Empty ⇒ off. */
  weekendDays: ReadonlySet<number>;
  /** Mon=0 … Sun=6 — the weekday the batch fires on (0 = that week's Monday). */
  triggerDay: number;
  /** "HH:MM" vessel-local send time. */
  askTime: string;
}

export const WEEKEND_COHORT_POLICY: WeekendCohortPolicy = {
  weekendDays: envDaySet("STAFFING_HORIZON_WEEKEND_DAYS"),
  triggerDay: envDayOfWeek("STAFFING_HORIZON_TRIGGER_DAY", 0),
  askTime: envWallClock("STAFFING_HORIZON_WEEKEND_ASK_TIME", "09:00"),
};

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
 * Staffing-horizon instant for a set of events. Pure; derived, never stored
 * (DEC-022). `null` when there's no scheduled event to anchor to.
 *
 * Default (`cohort.weekendDays` empty) is the flat DEC-022/062 lead: earliest
 * scheduled event minus `leadDays`. When weekend batching is on (DEC-116) and the
 * trip's **vessel-local** weekday is a configured weekend day, the horizon is
 * instead that week's shared trigger — `triggerDay` at `askTime` — so all of
 * Fri/Sat/Sun collapse onto one send. Weekday derives from `vesselDateOf`, never
 * `getUTCDay` on the raw instant, or an evening-Eastern trip lands in the wrong
 * day (DEC-032-class).
 */
export function staffingHorizonFromEvents(
  events: Event[],
  leadDays: number = STAFFING_HORIZON_LEAD_DAYS,
  tz: string = TENANT_TIMEZONE,
  cohort: WeekendCohortPolicy = WEEKEND_COHORT_POLICY,
): Date | null {
  const start = earliestScheduledStart(events, tz);
  if (start === null) return null;
  if (cohort.weekendDays.size > 0) {
    const tripDate = vesselDateOf(start, tz);
    const weekday = mondayZeroWeekday(tripDate);
    if (cohort.weekendDays.has(weekday)) {
      const anchorMonday = addDays(tripDate, -weekday);
      const triggerDate = addDays(anchorMonday, -((7 - cohort.triggerDay) % 7));
      return zonedWallClockToInstant(triggerDate, cohort.askTime, tz);
    }
  }
  return new Date(start.getTime() - leadDays * DAY_MS);
}

/** Staffing horizon for a shift, resolving its `eventIds` against `allEvents`. */
export function staffingHorizonFor(
  shift: Shift,
  allEvents: Event[],
  leadDays: number = STAFFING_HORIZON_LEAD_DAYS,
  tz: string = TENANT_TIMEZONE,
  cohort: WeekendCohortPolicy = WEEKEND_COHORT_POLICY,
): Date | null {
  const ids = new Set(shift.eventIds);
  return staffingHorizonFromEvents(
    allEvents.filter((e) => ids.has(e.id)),
    leadDays,
    tz,
    cohort,
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
 * *opening* (Pending→Filling, DEC-022).
 *
 * **Env-overridable** via `FILL_DEADLINE_HOURS` (DEC-115, mirroring DEC-062's
 * `STAFFING_HORIZON_LEAD_DAYS`), a **positive number** (fractional hours allowed;
 * garbage falls back), default **48** (2 days). The operator tunes it per deploy
 * — e.g. a Vercel env `FILL_DEADLINE_HOURS=72` for a 3-day At-Risk window — with
 * no code change. **Double-duty (DEC-031):** this same instant is the shown "fills
 * by" deadline AND the route-(b) At-Risk boarding instant, so a bump moves both by
 * design. The code default stays 48; #322 shipped the knob, not a value change.
 */
export const FILL_DEADLINE_HOURS = envPositiveNumber("FILL_DEADLINE_HOURS", 48);

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
 * Minutes a crew member stays AFTER the last trip returns to secure the boat —
 * the post-trip teardown buffer (#275, amends DEC-041). Distinct from, and
 * genuinely SHORTER than, the pre-trip `CALL_LEAD_MINUTES`: getting ready to sail
 * (fuel, safety brief, cast off) is more than tying up at the end. Was previously
 * the call lead reused symmetrically (a simplification that ran "back" long — a
 * 4pm last trip read as "back ~6pm"); split out so the shift-end reflects reality.
 * Flat, fleet-wide, plain constant — same posture as its siblings until a per-
 * vessel resolver lands.
 */
export const TEARDOWN_MINUTES = 25;

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
 * trip length + the post-trip `TEARDOWN_MINUTES` (#275 — a shorter, distinct
 * buffer than the pre-trip call lead; teardown < prep). Pure; derived, never
 * stored. `null` when no scheduled event anchors the shift. With a flat trip
 * length the latest *departure* yields the latest *end*; when per-event durations
 * land this becomes max(start+duration).
 */
export function shiftEndFromEvents(
  events: Event[],
  tz: string = TENANT_TIMEZONE,
): Date | null {
  const last = latestScheduledStart(events, tz);
  if (last === null) return null;
  return new Date(
    last.getTime() + (TRIP_DURATION_MINUTES + TEARDOWN_MINUTES) * MINUTE_MS,
  );
}

// ── Split suggestion (SPEC §2.3 "large mid-day gaps → 'split this?'") ──────────

/**
 * Dead-gap threshold, in **minutes** — inter-trip idle time above which a shift's
 * trips read as two work sessions ("go home and come back"), not one. Env knob
 * `SPLIT_SUGGEST_GAP_MINUTES`, default **120**. Tune-later, same posture as the
 * horizon leads.
 */
export const SPLIT_SUGGEST_GAP_MINUTES = envPositiveInt(
  "SPLIT_SUGGEST_GAP_MINUTES",
  120,
);

/**
 * Total-span threshold, in **minutes** — a day longer than this (first prep →
 * last teardown) is a one-crew-or-two fatigue/turnaround call even with no single
 * big gap. Env knob `SPLIT_SUGGEST_SPAN_MINUTES`, default **600** (10h).
 */
export const SPLIT_SUGGEST_SPAN_MINUTES = envPositiveInt(
  "SPLIT_SUGGEST_SPAN_MINUTES",
  600,
);

export interface SplitSuggestion {
  /**
   * `large-gap` — a concrete split point (crew would go home between trips);
   * `long-span` — no single big gap but the whole day is long (a human call).
   */
  reason: "large-gap" | "long-span";
  /** Dead-gap minutes (large-gap) or total-span minutes (long-span), rounded. */
  minutes: number;
  /** Present for `large-gap`: the departure clock times straddling the gap. */
  boundary?: { before: string; after: string };
}

/**
 * Whether a shift's trips warrant a **"split this?"** suggestion (SPEC §2.3).
 * PURE + ADVISORY — never auto-splits: `formShifts` stays one-shift-per-vessel-day
 * (the deterministic `shift-{vessel}-{date}` id + idempotency contract depends on
 * it), so a human resolves the suggestion in the Builder. Two independent triggers:
 *
 *  - **large-gap** — the dead time between one trip's teardown and the next's prep
 *    exceeds `gapMinutes`. Each trip occupies `[dep − CALL_LEAD, dep +
 *    TRIP_DURATION + TEARDOWN]` (#275 — the trailing buffer is the shorter
 *    teardown, not the call lead), so the dead gap between consecutive departures
 *    is `Δdep − (TRIP_DURATION + TEARDOWN + CALL_LEAD)`. The largest qualifying gap
 *    is reported (it names the split point) — gap wins over span.
 *  - **long-span** — no single big gap, but the whole day (first prep → last
 *    teardown = `Δ(first→last) + TRIP_DURATION + CALL_LEAD + TEARDOWN`) exceeds
 *    `spanMinutes`; one crew across it is a judgment call, hence a *suggestion*,
 *    not an auto-rule.
 *
 * `null` = no suggestion (fewer than two scheduled trips, or everything contiguous).
 * Cancelled events are ignored — a cancelled mid-day trip does not bridge the gap
 * its neighbours straddle.
 */
export function suggestSplit(
  events: Event[],
  tz: string = TENANT_TIMEZONE,
  opts?: { gapMinutes?: number; spanMinutes?: number },
): SplitSuggestion | null {
  const gapThreshold = opts?.gapMinutes ?? SPLIT_SUGGEST_GAP_MINUTES;
  const spanThreshold = opts?.spanMinutes ?? SPLIT_SUGGEST_SPAN_MINUTES;
  const trips = events
    .filter((e) => e.status === "scheduled")
    .map((e) => ({ at: eventStart(e, tz).getTime(), time: e.time }))
    .sort((a, b) => a.at - b.at);
  if (trips.length < 2) return null;
  const first = trips[0];
  const last = trips[trips.length - 1];
  if (!first || !last) return null; // unreachable (length ≥ 2) — narrows for noUncheckedIndexedAccess

  // Consecutive trips leave `Δdep − (TRIP_DURATION + TEARDOWN + CALL_LEAD)` of dead
  // time between one trip's teardown and the next's prep (#275 — teardown ≠ call
  // lead; same buffer split the shift-end got).
  const occupiedMin =
    TRIP_DURATION_MINUTES + TEARDOWN_MINUTES + CALL_LEAD_MINUTES;

  let worst: { minutes: number; before: string; after: string } | null = null;
  let prev = first;
  for (let i = 1; i < trips.length; i++) {
    const cur = trips[i];
    if (!cur) continue;
    const deadMin = (cur.at - prev.at) / MINUTE_MS - occupiedMin;
    if (deadMin > gapThreshold && (worst === null || deadMin > worst.minutes)) {
      worst = { minutes: deadMin, before: prev.time, after: cur.time };
    }
    prev = cur;
  }
  if (worst) {
    return {
      reason: "large-gap",
      minutes: Math.round(worst.minutes),
      boundary: { before: worst.before, after: worst.after },
    };
  }

  const spanMin = (last.at - first.at) / MINUTE_MS + occupiedMin;
  if (spanMin > spanThreshold) {
    return { reason: "long-span", minutes: Math.round(spanMin) };
  }
  return null;
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
