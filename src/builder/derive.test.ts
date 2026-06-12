/**
 * Pure derivation — deriveSeats (N-role) + deriveShiftState (DEC-005).
 * (Task 1.3 / M2.)
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { EventId, RoleTypeId, ShiftId } from "../domain/ids.js";
import type { Event, Seat, Shift, Vessel } from "../domain/entities.js";
import {
  bailLatenessMs,
  deriveSeats,
  deriveShiftState,
  fillDeadlineFor,
  fillDeadlineFromEvents,
  resolveShiftState,
  scheduledStarts,
  staffingHorizonFor,
  staffingHorizonFromEvents,
  FILL_DEADLINE_HOURS,
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
});

const shiftWith = (eventIds: string[]): Shift => ({
  id: SHIFT,
  vesselId: asId<"VesselId">("vessel-x"),
  date: "2026-05-16",
  state: "Pending",
  eventIds: eventIds.map((i) => asId<"EventId">(i)),
});

describe("staffingHorizonFromEvents", () => {
  it("is the earliest scheduled event minus leadDays (default 7d)", () => {
    const h = staffingHorizonFromEvents([
      ev("e1", "2026-05-16", "19:30"),
      ev("e2", "2026-05-16", "15:30"), // earliest of the day
    ]);
    // 2026-05-16T15:30Z − 7d = 2026-05-09T15:30Z
    expect(h?.toISOString()).toBe("2026-05-09T15:30:00.000Z");
  });

  it("honors a custom leadDays", () => {
    const h = staffingHorizonFromEvents([ev("e1", "2026-05-16", "15:30")], 3);
    expect(h?.toISOString()).toBe("2026-05-13T15:30:00.000Z");
  });

  it("ignores cancelled events when anchoring", () => {
    const h = staffingHorizonFromEvents([
      ev("e1", "2026-05-10", "08:00", "cancelled"), // earlier but cancelled — skipped
      ev("e2", "2026-05-16", "15:30"),
    ]);
    expect(h?.toISOString()).toBe("2026-05-09T15:30:00.000Z");
  });

  it("is null with no scheduled event to anchor to", () => {
    expect(staffingHorizonFromEvents([])).toBeNull();
    expect(staffingHorizonFromEvents([ev("e1", "2026-05-16", "15:30", "cancelled")])).toBeNull();
  });
});

describe("staffingHorizonFor", () => {
  it("resolves a shift's eventIds against the full event list", () => {
    const all = [ev("e1", "2026-05-16", "15:30"), ev("e9", "2026-05-01", "09:00")];
    const h = staffingHorizonFor(shiftWith(["e1"]), all); // e9 not in this shift
    expect(h?.toISOString()).toBe("2026-05-09T15:30:00.000Z");
  });
});

// ── scheduledStarts + fill deadline ("fills by", DEC-031) ────────────────────

describe("scheduledStarts", () => {
  it("returns every scheduled departure, earliest first", () => {
    const starts = scheduledStarts([
      ev("e1", "2026-05-16", "19:30"),
      ev("e2", "2026-05-16", "15:30"), // earlier — sorts first
    ]);
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

describe("fillDeadlineFromEvents", () => {
  it("is the earliest scheduled departure minus FILL_DEADLINE_HOURS (default 48h)", () => {
    const d = fillDeadlineFromEvents([
      ev("e1", "2026-05-16", "19:30"),
      ev("e2", "2026-05-16", "15:30"), // earliest anchors the deadline
    ]);
    // 2026-05-16T15:30Z − 48h = 2026-05-14T15:30Z
    expect(d?.toISOString()).toBe("2026-05-14T15:30:00.000Z");
    expect(FILL_DEADLINE_HOURS).toBe(48);
  });

  it("honors a custom hours override (the board threads deadlineHours)", () => {
    const d = fillDeadlineFromEvents([ev("e1", "2026-05-16", "15:30")], 24);
    expect(d?.toISOString()).toBe("2026-05-15T15:30:00.000Z");
  });

  it("ignores cancelled events when anchoring", () => {
    const d = fillDeadlineFromEvents([
      ev("e1", "2026-05-10", "08:00", "cancelled"),
      ev("e2", "2026-05-16", "15:30"),
    ]);
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
    const d = fillDeadlineFromEvents([ev("e1", "2026-05-16", "15:30")]);
    expect(d!.getTime()).toBeLessThan(
      new Date("2026-05-16T14:30:00.000Z").getTime(),
    );
  });
});

describe("fillDeadlineFor", () => {
  it("resolves a shift's eventIds against the full event list", () => {
    const all = [ev("e1", "2026-05-16", "15:30"), ev("e9", "2026-05-01", "09:00")];
    const d = fillDeadlineFor(shiftWith(["e1"]), all); // e9 not in this shift
    expect(d?.toISOString()).toBe("2026-05-14T15:30:00.000Z");
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
