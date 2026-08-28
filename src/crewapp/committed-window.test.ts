/**
 * `committedWindow` / `committedMinutes` — the crew-facing half of DEC-041's shift
 * window, and the half that stopped agreeing with the other one at #570.
 *
 * Both took departure clock strings and added the flat `TRIP_DURATION_MINUTES`, so
 * they could not see `Event.durationMinutes` at all. `shiftEndFromEvents` moved to
 * per-event durations; these did not. The result was two answers to "when is the
 * crew done": the operator's outbox card and the crew's own ask card rendering
 * different "back by" times for the same ask.
 *
 * These pin the agreement itself rather than the arithmetic — the arithmetic has a
 * home in `derive.test.ts` and a second copy of it here would be the thing that
 * drifts. `shiftEndFromEvents` is authoritative (DEC-129: the Date-based
 * computation, never a parallel "HH:mm" one); this is a formatter over it.
 */

import { describe, expect, it } from "vitest";
import {
  CALL_LEAD_MINUTES,
  TEARDOWN_MINUTES,
  TRIP_DURATION_MINUTES,
  shiftEndFromEvents,
} from "../builder/derive.js";
import { vesselClockOf } from "../config/tenant.js";
import type { Event } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { committedMinutes, committedWindow } from "./shift-card.js";

const TZ = "UTC";

const ev = (
  id: string,
  time: string,
  over: Partial<Event> = {},
): Event => ({
  id: asId<"EventId">(id),
  vesselId: asId<"VesselId">("vessel-x-shore-1"),
  date: "2026-09-06",
  time,
  capacity: 6,
  status: "scheduled",
  source: "xola",
  ...over,
});

describe("committedWindow — one computation with shiftEndFromEvents", () => {
  it("a 120-minute X Shore trip ends when shiftEndFromEvents says, not 100 minutes in", () => {
    const events = [ev("e1", "13:00", { durationMinutes: 120 })];

    const { shiftEndTime } = committedWindow(events, TZ);
    const authoritative = shiftEndFromEvents(events, TZ);

    // The whole point: these two must not be able to disagree.
    expect(shiftEndTime).toBe(vesselClockOf(authoritative!, TZ));
    // 13:00 + 120 trip + 25 teardown = 15:25. The flat constant would say 15:05.
    expect(shiftEndTime).toBe("15:25");
  });

  it("still uses the flat fallback for an event carrying no length of its own", () => {
    const events = [ev("e1", "13:00")]; // BrewBoat shape — no durationMinutes
    const { shiftEndTime } = committedWindow(events, TZ);
    expect(shiftEndTime).toBe(vesselClockOf(shiftEndFromEvents(events, TZ)!, TZ));
    expect(shiftEndTime).toBe("15:05"); // 13:00 + 100 + 25
  });

  it("call time is the EARLIEST departure minus the call lead", () => {
    const { callTime } = committedWindow(
      [ev("e2", "16:00"), ev("e1", "13:00")], // deliberately out of order
      TZ,
    );
    expect(callTime).toBe("12:15"); // 13:00 − 45
  });

  it("an earlier-but-longer trip anchors the end, matching shiftEndFromEvents (#570)", () => {
    // The mixed shift that makes `latestStart + duration` wrong: the noon charter
    // gets back after the sunset trip does.
    const events = [
      ev("e1", "12:00", { durationMinutes: 480 }), // ends 20:00
      ev("e2", "18:00"), // flat 100 → ends 19:40
    ];
    const { shiftEndTime } = committedWindow(events, TZ);
    expect(shiftEndTime).toBe(vesselClockOf(shiftEndFromEvents(events, TZ)!, TZ));
    expect(shiftEndTime).toBe("20:25"); // 12:00 + 480 + 25, NOT 18:00 + anything
  });

  it("ignores cancelled trips and returns an empty window with nothing scheduled", () => {
    const events = [
      ev("e1", "13:00", { durationMinutes: 120 }),
      ev("e2", "20:00", { status: "cancelled" }), // later, but moves neither boundary
    ];
    expect(committedWindow(events, TZ).shiftEndTime).toBe("15:25");
    expect(committedWindow([], TZ)).toEqual({});
    expect(committedMinutes([], TZ)).toBe(0);
  });
});

describe("committedMinutes — the payroll estimate follows the same window", () => {
  it("a 120-minute trip is paid 20 minutes longer than the flat constant", () => {
    const flat = committedMinutes([ev("e1", "13:00")], TZ);
    const long = committedMinutes([ev("e1", "13:00", { durationMinutes: 120 })], TZ);

    expect(flat).toBe(TRIP_DURATION_MINUTES + CALL_LEAD_MINUTES + TEARDOWN_MINUTES);
    expect(long).toBe(flat + 20);
  });

  it("is exactly the span of the window committedWindow reports", () => {
    const events = [
      ev("e1", "13:00", { durationMinutes: 120 }),
      ev("e2", "16:00"),
    ];
    const { callTime, shiftEndTime } = committedWindow(events, TZ);
    const toMin = (hhmm: string) => {
      const [h = 0, m = 0] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    expect(committedMinutes(events, TZ)).toBe(toMin(shiftEndTime!) - toMin(callTime!));
  });
});
