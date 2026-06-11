/**
 * Lock semantics (SPEC §2.3) — `changedSinceReviewed` pure derivation (DEC-029).
 * (Task 4.6.)
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { EventId, ReservationId, ShiftId } from "../domain/ids.js";
import type { Reservation, Shift } from "../domain/entities.js";
import { changedSinceReviewed } from "./lock.js";

const E1 = asId<"EventId">("evt-1");
const E2 = asId<"EventId">("evt-2");
const OTHER = asId<"EventId">("evt-other");

const shift = (lockedAt?: string, eventIds: EventId[] = [E1, E2]): Shift => ({
  id: asId<"ShiftId">("shift-1"),
  vesselId: asId<"VesselId">("vessel-1"),
  date: "2026-07-04",
  state: "Crewed",
  eventIds,
  ...(lockedAt ? { lockedAt } : {}),
});

const resv = (
  n: string,
  eventId: EventId,
  updatedAt?: string,
): Reservation => ({
  id: asId<"ReservationId">(`resv-${n}`),
  eventId,
  customerName: `Party ${n}`,
  partySize: 4,
  status: "booked",
  ...(updatedAt ? { updatedAt } : {}),
});

const LOCK = "2026-06-10T12:00:00.000Z";
const BEFORE = "2026-06-10T09:00:00.000Z";
const AFTER = "2026-06-10T18:00:00.000Z";

describe("changedSinceReviewed (DEC-029)", () => {
  it("nudges when a reservation changed after lock", () => {
    expect(
      changedSinceReviewed(shift(LOCK), [resv("a", E1, AFTER)]),
    ).toBe(true);
  });

  it("does not nudge an unlocked shift — it absorbs quietly", () => {
    expect(
      changedSinceReviewed(shift(undefined), [resv("a", E1, AFTER)]),
    ).toBe(false);
  });

  it("does not nudge when every change predates the lock", () => {
    expect(
      changedSinceReviewed(shift(LOCK), [
        resv("a", E1, BEFORE),
        resv("b", E2, BEFORE),
      ]),
    ).toBe(false);
  });

  it("re-lock (a later lockedAt) clears the nudge", () => {
    const later = "2026-06-10T23:00:00.000Z"; // after AFTER
    expect(
      changedSinceReviewed(shift(later), [resv("a", E1, AFTER)]),
    ).toBe(false);
  });

  it("ignores reservations on events not in this shift", () => {
    expect(
      changedSinceReviewed(shift(LOCK), [resv("a", OTHER, AFTER)]),
    ).toBe(false);
  });

  it("ignores reservations with no updatedAt (predate tracking)", () => {
    expect(
      changedSinceReviewed(shift(LOCK), [resv("a", E1, undefined)]),
    ).toBe(false);
  });

  it("an exact-tie updatedAt == lockedAt does not nudge (strictly after)", () => {
    expect(
      changedSinceReviewed(shift(LOCK), [resv("a", E1, LOCK)]),
    ).toBe(false);
  });

  it("nudges if ANY reservation changed after lock, others before", () => {
    expect(
      changedSinceReviewed(shift(LOCK), [
        resv("a", E1, BEFORE),
        resv("b", E2, AFTER),
      ]),
    ).toBe(true);
  });
});
