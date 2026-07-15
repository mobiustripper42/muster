/**
 * "Other shifts today" (#315) — the crew member's who-else-is-out-today view.
 * Reuses `deriveAllShifts`; here we assert the crew-facing narrowing: the current
 * shift is excluded, other days + cancelled are excluded, and each row carries
 * boat + first departure + assigned crew (no guests).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Seat, Shift } from "../domain/entities.js";
import type { SeatState } from "../domain/states.js";
import { otherShiftsOnDay } from "./other-shifts.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const TENANT = asId<"TenantId">("tenant-test");
const NOW = new Date("2026-07-03T12:00:00.000Z");

let repo: InMemoryRepository;
beforeEach(async () => {
  repo = new InMemoryRepository();
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
  await repo.saveRoleType({ id: MATE, tenantId: TENANT, name: "mate" });
});

interface SeatSpec {
  role?: typeof CAPTAIN | typeof MATE;
  state?: SeatState;
  crew?: { id: string; name: string };
}

async function addShift(
  id: string,
  date: string,
  vesselName: string,
  times: string[],
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
  for (const [i, t] of times.entries()) {
    const eventId = asId<"EventId">(`evt-${id}-${i}`);
    await repo.saveEvent({
      id: eventId,
      vesselId,
      date,
      time: t,
      capacity: 12,
      status: "scheduled",
      source: "xola",
    });
    eventIds.push(eventId);
  }
  await repo.saveShift({ id: asId<"ShiftId">(id), vesselId, date, state, eventIds });
  for (const [i, s] of seats.entries()) {
    if (s.crew) {
      await repo.saveCrewMember({
        id: asId<"CrewMemberId">(s.crew.id),
        name: s.crew.name,
        phone: "555",
        ratings: [],
        status: "active",
        reliabilityScore: null,
      });
    }
    const seat: Seat = {
      id: asId<"SeatId">(`seat-${id}-${i}`),
      shiftId: asId<"ShiftId">(id),
      role: s.role ?? CAPTAIN,
      kind: "required",
      state: s.state ?? "Open",
      ...(s.crew ? { assignedCrewMemberId: asId<"CrewMemberId">(s.crew.id) } : {}),
    };
    await repo.saveSeat(seat);
  }
}

describe("otherShiftsOnDay (#315)", () => {
  it("lists the day's OTHER shifts with boat, first departure, and assigned crew", async () => {
    // The viewer's own shift (excluded) + two others the same day + one next day.
    await addShift("mine", "2026-07-03", "Orca", ["10:00"], [
      { state: "Confirmed", crew: { id: "crew-me", name: "Me" } },
    ]);
    await addShift("other-late", "2026-07-03", "Hops", ["17:00", "19:00"], [
      { state: "Confirmed", crew: { id: "crew-quint", name: "Quint" } },
    ]);
    await addShift("other-early", "2026-07-03", "Firkin", ["09:00"], [
      { role: MATE, state: "Confirmed", crew: { id: "crew-bo", name: "Bo" } },
    ]);
    await addShift("tomorrow", "2026-07-04", "Growler", ["12:00"], [
      { state: "Confirmed", crew: { id: "crew-x", name: "X" } },
    ]);

    const rows = await otherShiftsOnDay(repo, "2026-07-03", "mine", NOW);

    // Excludes "mine" and "tomorrow"; sorted by earliest departure (09:00 first).
    expect(rows.map((r) => r.shiftId)).toEqual(["other-early", "other-late"]);
    expect(rows[0]).toEqual({
      shiftId: "other-early",
      vesselName: "Firkin",
      firstDeparture: "09:00",
      tripCount: 1, // single-trip day
      crew: [{ name: "Bo", role: "mate" }],
    });
    expect(rows[1]!.vesselName).toBe("Hops");
    expect(rows[1]!.firstDeparture).toBe("17:00"); // earliest of the two trips
    expect(rows[1]!.tripCount).toBe(2); // 17:00 + 19:00
    expect(rows[1]!.crew).toEqual([{ name: "Quint", role: "captain" }]);
  });

  it("excludes cancelled shifts and reports an uncrewed shift with an empty crew list", async () => {
    await addShift("mine", "2026-07-03", "Orca", ["10:00"], [{ state: "Open" }]);
    await addShift("dead", "2026-07-03", "Hops", ["14:00"], [
      { state: "Confirmed", crew: { id: "crew-q", name: "Quint" } },
    ], "Cancelled");
    await addShift("open", "2026-07-03", "Firkin", ["16:00"], [{ state: "Open" }]);

    const rows = await otherShiftsOnDay(repo, "2026-07-03", "mine", NOW);

    expect(rows.map((r) => r.shiftId)).toEqual(["open"]); // dead is cancelled
    expect(rows[0]!.crew).toEqual([]); // nothing crewed yet
  });

  it("returns empty when the viewer's shift is the only one that day", async () => {
    await addShift("mine", "2026-07-03", "Orca", ["10:00"], [{ state: "Open" }]);
    expect(await otherShiftsOnDay(repo, "2026-07-03", "mine", NOW)).toEqual([]);
  });
});
