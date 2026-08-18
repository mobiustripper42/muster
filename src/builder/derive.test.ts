/**
 * Pure derivation — deriveSeats (N-role) + deriveShiftState (DEC-005).
 * (Task 1.3 / M2.)
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { asId } from "../domain/ids.js";
import type { RoleTypeId } from "../domain/ids.js";
import type { Event, Seat, Shift, Vessel } from "../domain/entities.js";
import {
  bailLatenessMs,
  deriveSeats,
  deriveShiftState,
  fillDeadlineFor,
  fillDeadlineFromEvents,
  resolveShiftState,
  scheduledStarts,
  latestScheduledStart,
  eventDurationMinutes,
  shiftEndFromEvents,
  staffingHorizonFor,
  staffingHorizonFromEvents,
  FILL_DEADLINE_HOURS,
  STAFFING_HORIZON_LEAD_DAYS,
  TRIP_DURATION_MINUTES,
  CALL_LEAD_MINUTES,
  TEARDOWN_MINUTES,
} from "./derive.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const DECKHAND = asId<"RoleTypeId">("role-deckhand");
const SHIFT = asId<"ShiftId">("shift-x");

const vessel = (manning: Vessel["manning"]): Vessel => ({
  id: asId<"VesselId">("vessel-x"),
  name: "X",
  coiMaxPax: 16,
  manning,
});

const seat = (role: RoleTypeId, state: Seat["state"], kind: Seat["kind"] = "required"): Seat => ({
  id: asId<"SeatId">(`seat-${role}-${state}`),
  shiftId: SHIFT,
  role,
  kind,
  state,
});

describe("deriveSeats", () => {
  it("iterates an N-role manning list (3 roles, 4 seats)", () => {
    const seats = deriveSeats(
      vessel([
        { roleTypeId: CAPTAIN, count: 1 },
        { roleTypeId: MATE, count: 1 },
        { roleTypeId: DECKHAND, count: 2 },
      ]),
      SHIFT,
    );
    expect(seats).toHaveLength(4);
    expect(seats.map((s) => s.role)).toEqual([CAPTAIN, MATE, DECKHAND, DECKHAND]);
    expect(seats.every((s) => s.kind === "required" && s.state === "Open")).toBe(true);
    // Deterministic, unique ids (stable across re-derive).
    expect(new Set(seats.map((s) => s.id)).size).toBe(4);
  });

  it("yields zero seats for a zero-crew vessel (self-captained rental)", () => {
    expect(deriveSeats(vessel([]), SHIFT)).toHaveLength(0);
  });
});

describe("deriveShiftState", () => {
  it("is Crewed (vacuously) when no required seats exist", () => {
    expect(deriveShiftState([])).toBe("Crewed");
    expect(deriveShiftState([seat(CAPTAIN, "Open", "supernumerary")])).toBe("Crewed");
  });

  it("is Pending when all required seats are Open", () => {
    expect(deriveShiftState([seat(CAPTAIN, "Open"), seat(MATE, "Open")])).toBe("Pending");
  });

  it("is Filling when some required seat has progressed", () => {
    expect(deriveShiftState([seat(CAPTAIN, "Asked"), seat(MATE, "Open")])).toBe("Filling");
    expect(deriveShiftState([seat(CAPTAIN, "Claimed"), seat(MATE, "Open")])).toBe("Filling");
  });

  it("is Crewed only when every required seat is Confirmed", () => {
    expect(deriveShiftState([seat(CAPTAIN, "Confirmed"), seat(MATE, "Confirmed")])).toBe("Crewed");
    expect(deriveShiftState([seat(CAPTAIN, "Confirmed"), seat(MATE, "Open")])).toBe("Filling");
  });

  it("is AtRisk when any required seat bailed (even if others confirmed)", () => {
    expect(deriveShiftState([seat(CAPTAIN, "Confirmed"), seat(MATE, "Bailed")])).toBe("AtRisk");
  });
});

// ── Staffing-horizon clock (DEC-022) ─────────────────────────────────────────

const ev = (id: string, date: string, time: string, status: Event["status"] = "scheduled"): Event => ({
  id: asId<"EventId">(id),
  vesselId: asId<"VesselId">("vessel-x"),
  date,
  time,
  capacity: 16,
  status,
  source: "xola",
});

const shiftWith = (eventIds: string[]): Shift => ({
  id: SHIFT,
  vesselId: asId<"VesselId">("vessel-x"),
  date: "2026-05-16",
  state: "Pending",
  eventIds: eventIds.map((i) => asId<"EventId">(i)),
});

// These fixtures pin `tz: "UTC"` so the wall-clock interprets 1:1 to the asserted
// instant (DEC-032 threads tz through; UTC keeps the engine's fixtures
// deterministic). Vessel-tz interpretation + DST is covered by its own block below.

describe("staffingHorizonFromEvents", () => {
  it("is the earliest scheduled event minus leadDays (default 7d)", () => {
    const h = staffingHorizonFromEvents([
      ev("e1", "2026-05-16", "19:30"),
      ev("e2", "2026-05-16", "15:30"), // earliest of the day
    ], undefined, "UTC");
    // 2026-05-16T15:30Z − 7d = 2026-05-09T15:30Z
    expect(h?.toISOString()).toBe("2026-05-09T15:30:00.000Z");
  });

  it("honors a custom leadDays", () => {
    const h = staffingHorizonFromEvents([ev("e1", "2026-05-16", "15:30")], 3, "UTC");
    expect(h?.toISOString()).toBe("2026-05-13T15:30:00.000Z");
  });

  it("ignores cancelled events when anchoring", () => {
    const h = staffingHorizonFromEvents([
      ev("e1", "2026-05-10", "08:00", "cancelled"), // earlier but cancelled — skipped
      ev("e2", "2026-05-16", "15:30"),
    ], undefined, "UTC");
    expect(h?.toISOString()).toBe("2026-05-09T15:30:00.000Z");
  });

  it("is null with no scheduled event to anchor to", () => {
    expect(staffingHorizonFromEvents([])).toBeNull();
    expect(staffingHorizonFromEvents([ev("e1", "2026-05-16", "15:30", "cancelled")])).toBeNull();
  });
});

// ── Weekend batch trigger (DEC-116) ──────────────────────────────────────────
// A trip whose VESSEL-LOCAL weekday is a configured weekend day fires on ONE
// shared instant — that week's TRIGGER_DAY at ASK_TIME — instead of its own flat
// lead, so all of Fri/Sat/Sun collapse onto a single Monday-9am send. Policy is
// passed explicitly here (the module default reads env; unset = off = flat).
// Mon=0..Sun=6. 2026-05-16 is a Saturday (weekday 5); that week's Monday is 05-11.
describe("staffingHorizonFromEvents — weekend batch trigger (DEC-116)", () => {
  const weekend = { weekendDays: new Set([4, 5, 6]), triggerDay: 0, askTime: "09:00" };

  it("off (empty weekendDays) → flat lead, unchanged", () => {
    const h = staffingHorizonFromEvents(
      [ev("e1", "2026-05-16", "15:30")], undefined, "UTC",
      { weekendDays: new Set<number>(), triggerDay: 0, askTime: "09:00" },
    );
    expect(h?.toISOString()).toBe("2026-05-09T15:30:00.000Z"); // 05-16 − 7d
  });

  it("a Saturday trip fires that week's Monday at ASK_TIME, not start−lead", () => {
    const h = staffingHorizonFromEvents(
      [ev("e1", "2026-05-16", "15:30")], undefined, "UTC", weekend,
    );
    expect(h?.toISOString()).toBe("2026-05-11T09:00:00.000Z");
  });

  it("collapses Fri, Sat, Sun of one weekend onto the same instant", () => {
    const iso = (date: string) =>
      staffingHorizonFromEvents([ev("e1", date, "15:30")], undefined, "UTC", weekend)?.toISOString();
    expect(iso("2026-05-15")).toBe("2026-05-11T09:00:00.000Z"); // Fri
    expect(iso("2026-05-16")).toBe("2026-05-11T09:00:00.000Z"); // Sat
    expect(iso("2026-05-17")).toBe("2026-05-11T09:00:00.000Z"); // Sun
  });

  it("TRIGGER_DAY=6 fires the Sunday before that Monday", () => {
    const h = staffingHorizonFromEvents(
      [ev("e1", "2026-05-16", "15:30")], undefined, "UTC",
      { ...weekend, triggerDay: 6 },
    );
    expect(h?.toISOString()).toBe("2026-05-10T09:00:00.000Z"); // Sun before Mon 05-11
  });

  it("a non-weekend trip keeps the flat lead even with cohort on", () => {
    const h = staffingHorizonFromEvents(
      [ev("e1", "2026-05-13", "15:30")], undefined, "UTC", weekend, // Wed (weekday 2)
    );
    expect(h?.toISOString()).toBe("2026-05-06T15:30:00.000Z"); // 05-13 − 7d, flat
  });

  it("classifies the weekday from the VESSEL-LOCAL date, not the UTC instant", () => {
    // 8pm Sun ET = Mon 00:00 UTC. getUTCDay on the instant would read Monday (0,
    // non-weekend → flat, wrong). vesselDateOf pins it to Sun (weekday 6) → cohort.
    const h = staffingHorizonFromEvents(
      [ev("e1", "2026-05-17", "20:00")], undefined, "America/New_York", weekend,
    );
    // Sun 05-17 → that week's Mon 05-11, 09:00 EDT (UTC−4) = 13:00Z.
    expect(h?.toISOString()).toBe("2026-05-11T13:00:00.000Z");
  });
});

describe("staffingHorizonFor", () => {
  it("resolves a shift's eventIds against the full event list", () => {
    const all = [ev("e1", "2026-05-16", "15:30"), ev("e9", "2026-05-01", "09:00")];
    const h = staffingHorizonFor(shiftWith(["e1"]), all, undefined, "UTC"); // e9 not in this shift
    expect(h?.toISOString()).toBe("2026-05-09T15:30:00.000Z");
  });
});

// ── scheduledStarts + fill deadline ("fills by", DEC-031) ────────────────────

describe("scheduledStarts", () => {
  it("returns every scheduled departure, earliest first", () => {
    const starts = scheduledStarts([
      ev("e1", "2026-05-16", "19:30"),
      ev("e2", "2026-05-16", "15:30"), // earlier — sorts first
    ], "UTC");
    expect(starts.map((d) => d.toISOString())).toEqual([
      "2026-05-16T15:30:00.000Z",
      "2026-05-16T19:30:00.000Z",
    ]);
  });

  it("drops cancelled trips and is empty with nothing scheduled", () => {
    expect(
      scheduledStarts([ev("e1", "2026-05-16", "15:30", "cancelled")]),
    ).toEqual([]);
    expect(scheduledStarts([])).toEqual([]);
  });
});

// ── Shift window: latest departure + shift end (DEC-041) ──────────────────────

describe("latestScheduledStart", () => {
  it("is the last scheduled departure (mirror of earliest), null when empty", () => {
    const d = latestScheduledStart([
      ev("e1", "2026-05-16", "15:30"),
      ev("e2", "2026-05-16", "19:30"), // latest
    ], "UTC");
    expect(d?.toISOString()).toBe("2026-05-16T19:30:00.000Z");
    expect(latestScheduledStart([ev("e1", "2026-05-16", "19:30", "cancelled")], "UTC")).toBeNull();
    expect(latestScheduledStart([])).toBeNull();
  });
});

describe("shiftEndFromEvents", () => {
  it("is the latest departure + trip length + teardown (DEC-041, #275)", () => {
    const end = shiftEndFromEvents([
      ev("e1", "2026-05-16", "15:30"),
      ev("e2", "2026-05-16", "19:30"), // last trip anchors the end
    ], "UTC");
    // 19:30Z + (100 trip + 25 teardown)m = 19:30 + 2h5m = 21:35Z
    expect(end?.toISOString()).toBe("2026-05-16T21:35:00.000Z");
    expect(TRIP_DURATION_MINUTES).toBe(100);
    expect(TEARDOWN_MINUTES).toBe(25);
    // Teardown is genuinely shorter than the pre-trip call lead (#275).
    expect(TEARDOWN_MINUTES).toBeLessThan(CALL_LEAD_MINUTES);
  });

  it("ignores cancelled trips and is null with nothing scheduled", () => {
    const end = shiftEndFromEvents([
      ev("e1", "2026-05-16", "19:30"),
      ev("e2", "2026-05-20", "12:00", "cancelled"), // later but cancelled — skipped
    ], "UTC");
    expect(end?.toISOString()).toBe("2026-05-16T21:35:00.000Z");
    expect(shiftEndFromEvents([])).toBeNull();
  });

  it("uses each event's own durationMinutes when it carries one (#570)", () => {
    const end = shiftEndFromEvents(
      [{ ...ev("e1", "2026-05-16", "19:30"), durationMinutes: 240 }],
      "UTC",
    );
    // 19:30Z + (240 offering length + 25 teardown) = 23:55Z — NOT the flat 100.
    expect(end?.toISOString()).toBe("2026-05-16T23:55:00.000Z");
  });

  it("falls back to the flat constant per-event, so a mixed shift uses both (#570)", () => {
    const end = shiftEndFromEvents(
      [
        { ...ev("e1", "2026-05-16", "12:00"), durationMinutes: 240 }, // ends 16:00
        ev("e2", "2026-05-16", "15:00"), // no length → flat 100 → ends 16:40
      ],
      "UTC",
    );
    // Later END is the flat-fallback trip: 16:40 + 25 teardown = 17:05Z.
    expect(end?.toISOString()).toBe("2026-05-16T17:05:00.000Z");
  });

  it("is max(start + duration), NOT latest start + duration (#570)", () => {
    // The regression this guards: a long charter departing EARLY and a short
    // sunset departing LATE. Anchoring on the latest DEPARTURE (18:00 + 60 + 25 =
    // 19:25) reads the shift as over while the noon charter is still on the water
    // until 20:00. Completion keys on this instant, so the wrong pick pays out
    // reliability for a trip that hasn't finished.
    const charterEnds = shiftEndFromEvents(
      [
        { ...ev("e1", "2026-05-16", "12:00"), durationMinutes: 480 }, // ends 20:00
        { ...ev("e2", "2026-05-16", "18:00"), durationMinutes: 60 }, // ends 19:00
      ],
      "UTC",
    );
    expect(charterEnds?.toISOString()).toBe("2026-05-16T20:25:00.000Z");
    // Sanity: the latest DEPARTURE is the sunset, so the two rules genuinely differ.
    expect(
      latestScheduledStart(
        [ev("e1", "2026-05-16", "12:00"), ev("e2", "2026-05-16", "18:00")],
        "UTC",
      )?.toISOString(),
    ).toBe("2026-05-16T18:00:00.000Z");
  });

  it("eventDurationMinutes: own value wins, absent falls back", () => {
    expect(
      eventDurationMinutes({ ...ev("e", "2026-05-16", "12:00"), durationMinutes: 45 }),
    ).toBe(45);
    expect(eventDurationMinutes(ev("e", "2026-05-16", "12:00"))).toBe(
      TRIP_DURATION_MINUTES,
    );
  });
});

describe("fillDeadlineFromEvents", () => {
  it("is the earliest scheduled departure minus FILL_DEADLINE_HOURS (default 48h)", () => {
    const d = fillDeadlineFromEvents([
      ev("e1", "2026-05-16", "19:30"),
      ev("e2", "2026-05-16", "15:30"), // earliest anchors the deadline
    ], undefined, "UTC");
    // 2026-05-16T15:30Z − 48h = 2026-05-14T15:30Z
    expect(d?.toISOString()).toBe("2026-05-14T15:30:00.000Z");
    expect(FILL_DEADLINE_HOURS).toBe(48);
  });

  it("honors a custom hours override (the board threads deadlineHours)", () => {
    const d = fillDeadlineFromEvents([ev("e1", "2026-05-16", "15:30")], 24, "UTC");
    expect(d?.toISOString()).toBe("2026-05-15T15:30:00.000Z");
  });

  it("ignores cancelled events when anchoring", () => {
    const d = fillDeadlineFromEvents([
      ev("e1", "2026-05-10", "08:00", "cancelled"),
      ev("e2", "2026-05-16", "15:30"),
    ], undefined, "UTC");
    expect(d?.toISOString()).toBe("2026-05-14T15:30:00.000Z");
  });

  it("is null with no scheduled event to anchor to (rendered as absence)", () => {
    expect(fillDeadlineFromEvents([])).toBeNull();
    expect(
      fillDeadlineFromEvents([ev("e1", "2026-05-16", "15:30", "cancelled")]),
    ).toBeNull();
  });

  it("returns a past instant when overdue (callers render honestly, never clamped)", () => {
    // A trip 1h out: the 48h deadline is 47h in the past.
    const d = fillDeadlineFromEvents([ev("e1", "2026-05-16", "15:30")], undefined, "UTC");
    expect(d!.getTime()).toBeLessThan(
      new Date("2026-05-16T14:30:00.000Z").getTime(),
    );
  });
});

describe("fillDeadlineFor", () => {
  it("resolves a shift's eventIds against the full event list", () => {
    const all = [ev("e1", "2026-05-16", "15:30"), ev("e9", "2026-05-01", "09:00")];
    const d = fillDeadlineFor(shiftWith(["e1"]), all, undefined, "UTC"); // e9 not in this shift
    expect(d?.toISOString()).toBe("2026-05-14T15:30:00.000Z");
  });
});

// ── vessel-local interpretation + DST (DEC-032) ──────────────────────────────

describe("vessel-local time interpretation (DEC-032)", () => {
  const NY = "America/New_York";

  it("mints a summer (EDT, −4) wall-clock as the true instant", () => {
    // "2026-07-04 14:00" Eastern = 18:00 UTC (EDT is UTC−4).
    const [start] = scheduledStarts([ev("e1", "2026-07-04", "14:00")], NY);
    expect(start!.toISOString()).toBe("2026-07-04T18:00:00.000Z");
  });

  it("mints a winter (EST, −5) wall-clock as the true instant — DST-correct", () => {
    // "2026-01-04 14:00" Eastern = 19:00 UTC (EST is UTC−5). Same wall-clock,
    // different offset → proves the conversion follows DST, not a fixed offset.
    const [start] = scheduledStarts([ev("e1", "2026-01-04", "14:00")], NY);
    expect(start!.toISOString()).toBe("2026-01-04T19:00:00.000Z");
  });

  it("mints correctly on the spring-forward morning (two-pass — not off by an hour)", () => {
    // 2026-03-08 is DST spring-forward (02:00 EST → 03:00 EDT). 03:30 is a valid
    // EDT wall-clock = 07:30 UTC; a naive one-pass conversion mis-mints it to
    // 08:30Z (picks up the stale EST offset at the UTC guess).
    const [start] = scheduledStarts([ev("e1", "2026-03-08", "03:30")], NY);
    expect(start!.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("the default tz is the tenant zone (Eastern), not UTC", () => {
    // No tz arg → TENANT_TIMEZONE. A summer noon Eastern is 16:00 UTC, not 12:00.
    const [start] = scheduledStarts([ev("e1", "2026-07-04", "12:00")]);
    expect(start!.toISOString()).toBe("2026-07-04T16:00:00.000Z");
  });

  it("horizon + fill deadline ride the vessel-local instant", () => {
    const events = [ev("e1", "2026-07-04", "14:00")]; // 18:00Z
    expect(staffingHorizonFromEvents(events, 7, NY)?.toISOString()).toBe(
      "2026-06-27T18:00:00.000Z", // 18:00Z − 7d
    );
    expect(fillDeadlineFromEvents(events, 48, NY)?.toISOString()).toBe(
      "2026-07-02T18:00:00.000Z", // 18:00Z − 48h
    );
  });
});

describe("resolveShiftState (horizon overlay, DEC-022)", () => {
  const horizon = new Date("2026-05-09T15:30:00.000Z");
  const before = new Date("2026-05-01T00:00:00.000Z");
  const after = new Date("2026-05-10T00:00:00.000Z");
  const open = [seat(CAPTAIN, "Open"), seat(MATE, "Open")];

  it("returns a Crewed shift as-is regardless of time", () => {
    const crewed = [seat(CAPTAIN, "Confirmed"), seat(MATE, "Confirmed")];
    expect(resolveShiftState(crewed, { now: before, horizon, poolExhausted: false })).toBe("Crewed");
  });

  it("falls back to the seat-fold when there is no horizon anchor", () => {
    expect(resolveShiftState(open, { now: after, horizon: null, poolExhausted: false })).toBe("Pending");
  });

  it("is Pending before the horizon (crew rules abstain)", () => {
    expect(resolveShiftState(open, { now: before, horizon, poolExhausted: false })).toBe("Pending");
  });

  it("is born into Filling once the horizon is crossed", () => {
    expect(resolveShiftState(open, { now: after, horizon, poolExhausted: false })).toBe("Filling");
  });

  it("is AtRisk past the horizon when the pool is exhausted", () => {
    expect(resolveShiftState(open, { now: after, horizon, poolExhausted: true })).toBe("AtRisk");
  });

  it("keeps a bail-driven AtRisk (seat-fold) past the horizon", () => {
    const bailed = [seat(CAPTAIN, "Confirmed"), seat(MATE, "Bailed")];
    expect(resolveShiftState(bailed, { now: after, horizon, poolExhausted: false })).toBe("AtRisk");
  });

  it("lets the seat-fold's own Filling stand past the horizon", () => {
    const working = [seat(CAPTAIN, "Asked"), seat(MATE, "Open")];
    expect(resolveShiftState(working, { now: after, horizon, poolExhausted: false })).toBe("Filling");
  });
});

describe("bailLatenessMs (DEC-028)", () => {
  const DAY = 24 * 3600_000;
  const trip = new Date("2026-07-10T15:00:00.000Z");
  const before = (days: number) => new Date(trip.getTime() - days * DAY);

  it("full notice (≥ lead) → 0: a cancel a week out is cheap", () => {
    expect(bailLatenessMs(trip, before(7))).toBe(0);
    expect(bailLatenessMs(trip, before(30))).toBe(0);
  });

  it("scales inside the window: 2d notice on a 7d lead → 5d of lateness", () => {
    expect(bailLatenessMs(trip, before(2))).toBe(5 * DAY);
  });

  it("at departure → the full lead (the 11pm bail ceiling)", () => {
    expect(bailLatenessMs(trip, trip)).toBe(7 * DAY);
  });

  it("clamps past departure — no_show territory is a separate event", () => {
    expect(bailLatenessMs(trip, new Date(trip.getTime() + 2 * DAY))).toBe(7 * DAY);
  });

  it("no trip anchor → 0 (nothing to be late against)", () => {
    expect(bailLatenessMs(null, before(1))).toBe(0);
  });

  it("honors a custom leadDays", () => {
    expect(bailLatenessMs(trip, before(1), 3)).toBe(2 * DAY);
  });
});

describe("STAFFING_HORIZON_LEAD_DAYS env override (DEC-062)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to 7 days", () => {
    expect(STAFFING_HORIZON_LEAD_DAYS).toBe(7);
  });

  it("a positive-integer env override replaces the default", async () => {
    vi.stubEnv("STAFFING_HORIZON_LEAD_DAYS", "3");
    vi.resetModules();
    const m = await import("./derive.js");
    expect(m.STAFFING_HORIZON_LEAD_DAYS).toBe(3);
  });

  it("accepts a positive FRACTION (sub-day lead — DEC-062 float knob)", async () => {
    vi.stubEnv("STAFFING_HORIZON_LEAD_DAYS", "6.1");
    vi.resetModules();
    const m = await import("./derive.js");
    expect(m.STAFFING_HORIZON_LEAD_DAYS).toBe(6.1);
  });

  it("a non-positive or garbage override falls back to 7", async () => {
    for (const bad of ["0", "-2", "lots", "", " ", "NaN"]) {
      vi.stubEnv("STAFFING_HORIZON_LEAD_DAYS", bad);
      vi.resetModules();
      const m = await import("./derive.js");
      expect(m.STAFFING_HORIZON_LEAD_DAYS).toBe(7);
    }
  });
});

describe("FILL_DEADLINE_HOURS env override (DEC-115 / #322)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to 48 hours (2 days) — value unchanged by #322", () => {
    expect(FILL_DEADLINE_HOURS).toBe(48);
  });

  it("a positive-integer env override replaces the default (e.g. 72 = 3 days)", async () => {
    vi.stubEnv("FILL_DEADLINE_HOURS", "72");
    vi.resetModules();
    const m = await import("./derive.js");
    expect(m.FILL_DEADLINE_HOURS).toBe(72);
  });

  it("accepts a positive FRACTION (sub-hour tuning)", async () => {
    vi.stubEnv("FILL_DEADLINE_HOURS", "60.5");
    vi.resetModules();
    const m = await import("./derive.js");
    expect(m.FILL_DEADLINE_HOURS).toBe(60.5);
  });

  it("a non-positive or garbage override falls back to 48", async () => {
    for (const bad of ["0", "-12", "soon", "", " ", "NaN"]) {
      vi.stubEnv("FILL_DEADLINE_HOURS", bad);
      vi.resetModules();
      const m = await import("./derive.js");
      expect(m.FILL_DEADLINE_HOURS).toBe(48);
    }
  });
});
