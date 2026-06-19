/**
 * "All shifts" derivation (#100, DEC-042). Tests the read-model's own logic —
 * window filtering, cancelled/completed exclusion, trip aggregation + sort, pax,
 * seat-fill counts, and row ordering. The live-state resolution it delegates to
 * `resolveShiftStateOnRead` is exercised in tick's suite; here we assert one
 * clean Crewed case to prove the wiring, not the whole state machine.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMemberId, SeatId } from "../domain/ids.js";
import type { Seat, Shift } from "../domain/entities.js";
import type { SeatState } from "../domain/states.js";
import { deriveAllShifts } from "./all-shifts.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const T0 = new Date("2026-07-01T12:00:00.000Z");
// Lead 7d (default) → a trip a couple days out is past its horizon at T0.
const OPTS = { leadDays: 7, tz: "UTC" };

let repo: InMemoryRepository;
beforeEach(() => {
  repo = new InMemoryRepository();
});

interface TripSpec {
  time: string;
  pax: number[]; // one booked reservation per party size
}
interface SeatSpec {
  role?: typeof CAPTAIN | typeof MATE;
  state?: SeatState;
}

async function addShift(
  id: string,
  date: string,
  vesselName: string,
  trips: TripSpec[],
  seats: SeatSpec[],
  state: Shift["state"] = "Filling",
): Promise<void> {
  const vesselId = asId<"VesselId">(`vessel-${id}`);
  await repo.saveVessel({
    id: vesselId,
    name: vesselName,
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }],
  });
  const eventIds = [];
  for (const [i, t] of trips.entries()) {
    const eventId = asId<"EventId">(`evt-${id}-${i}`);
    await repo.saveEvent({
      id: eventId,
      vesselId,
      date,
      time: t.time,
      capacity: 12,
      status: "scheduled",
    });
    for (const [j, party] of t.pax.entries()) {
      await repo.saveReservation({
        id: asId<"ReservationId">(`r-${id}-${i}-${j}`),
        eventId,
        customerName: `party ${j}`,
        partySize: party,
        status: "booked",
      });
    }
    eventIds.push(eventId);
  }
  await repo.saveShift({ id: asId<"ShiftId">(id), vesselId, date, state, eventIds });
  for (const [i, s] of seats.entries()) {
    const seat: Seat = {
      id: asId<"SeatId">(`seat-${id}-${i}`),
      shiftId: asId<"ShiftId">(id),
      role: s.role ?? CAPTAIN,
      kind: "required",
      state: s.state ?? "Open",
    };
    await repo.saveSeat(seat);
  }
}

describe("deriveAllShifts", () => {
  it("returns current shifts in the window with trips, pax, and seat fill", async () => {
    await addShift(
      "s-crewed",
      "2026-07-03",
      "Hops",
      [{ time: "17:00", pax: [2] }, { time: "15:00", pax: [4, 6] }],
      [{ state: "Confirmed" }, { role: MATE, state: "Confirmed" }],
      "Crewed",
    );

    const rows = await deriveAllShifts(
      repo,
      { from: "2026-07-01", to: "2026-07-31" },
      T0,
      OPTS,
    );

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.vesselName).toBe("Hops");
    expect(row.state).toBe("Crewed"); // resolved on read, not the persisted badge
    expect(row.trips.map((t) => t.time)).toEqual(["15:00", "17:00"]); // earliest first
    expect(row.trips[0]!.pax).toBe(10); // 4 + 6
    expect(row.paxTotal).toBe(12);
    expect(row.requiredSeats).toBe(2);
    expect(row.confirmedSeats).toBe(2);
  });

  it("excludes cancelled and completed shifts", async () => {
    await addShift("alive", "2026-07-03", "Hops", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("dead", "2026-07-03", "Kettle", [{ time: "15:00", pax: [2] }], [{ state: "Open" }], "Cancelled");
    await addShift("done", "2026-07-03", "Firkin", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Completed");

    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    expect(rows.map((r) => r.vesselName)).toEqual(["Hops"]);
  });

  it("filters to the date window (inclusive)", async () => {
    await addShift("before", "2026-07-02", "Before", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("inside", "2026-07-05", "Inside", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("after", "2026-07-09", "After", [{ time: "15:00", pax: [2] }], [{ state: "Confirmed" }], "Crewed");

    const rows = await deriveAllShifts(repo, { from: "2026-07-05", to: "2026-07-05" }, T0, OPTS);
    expect(rows.map((r) => r.vesselName)).toEqual(["Inside"]);
  });

  it("sorts by date then earliest departure", async () => {
    await addShift("d2-late", "2026-07-05", "D2Late", [{ time: "16:00", pax: [1] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("d1", "2026-07-04", "D1", [{ time: "18:00", pax: [1] }], [{ state: "Confirmed" }], "Crewed");
    await addShift("d2-early", "2026-07-05", "D2Early", [{ time: "09:00", pax: [1] }], [{ state: "Confirmed" }], "Crewed");

    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    expect(rows.map((r) => r.vesselName)).toEqual(["D1", "D2Early", "D2Late"]);
  });

  it("counts only scheduled trips and booked reservations toward pax", async () => {
    await addShift("mixed", "2026-07-05", "Mixed", [{ time: "15:00", pax: [3] }], [{ state: "Confirmed" }], "Crewed");
    // A cancelled reservation must not count toward pax.
    await repo.saveReservation({
      id: asId<"ReservationId">("r-cancelled"),
      eventId: asId<"EventId">("evt-mixed-0"),
      customerName: "no-show party",
      partySize: 5,
      status: "cancelled",
    });
    const rows = await deriveAllShifts(repo, { from: "2026-07-01", to: "2026-07-31" }, T0, OPTS);
    expect(rows[0]!.paxTotal).toBe(3);
  });
});
