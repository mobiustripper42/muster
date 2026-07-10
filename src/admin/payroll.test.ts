/**
 * Payroll report (#347) — DEC-041 on-clock minutes summed per crew member over a
 * pay period. Covers the window filter, the Cancelled-shift exclusion, the
 * required-only (no supernumerary/trainee) rule, and multi-trip shift minutes.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Event, Seat, Shift } from "../domain/entities.js";
import { buildPayrollReport } from "./payroll.js";

const CAP = asId<"RoleTypeId">("role-captain");
const V = asId<"VesselId">("vessel-1");
const QUINT = asId<"CrewMemberId">("crew-quint");
const HOOPER = asId<"CrewMemberId">("crew-hooper");
const TRAINEE = asId<"CrewMemberId">("crew-trainee");

const crew = (id: string, name: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name,
  phone: "+15035550100",
  ratings: [CAP],
  status: "active",
  reliabilityScore: null,
});

const shift = (id: string, date: string, eventIds: string[], state: Shift["state"] = "Crewed"): Shift => ({
  id: asId<"ShiftId">(id),
  vesselId: V,
  date,
  state,
  eventIds: eventIds.map((e) => asId<"EventId">(e)),
});

const event = (id: string, date: string, time: string, status: Event["status"] = "scheduled"): Event => ({
  id: asId<"EventId">(id),
  vesselId: V,
  date,
  time,
  capacity: 6,
  status,
});

const seat = (
  id: string,
  shiftId: string,
  crewId: string,
  kind: Seat["kind"] = "required",
  state: Seat["state"] = "Confirmed",
): Seat => ({
  id: asId<"SeatId">(id),
  shiftId: asId<"ShiftId">(shiftId),
  role: CAP,
  kind,
  state,
  assignedCrewMemberId: asId<"CrewMemberId">(crewId),
});

// committedMinutes = (last − first departure) + TRIP_DURATION(100) + 2×CALL_LEAD(45).
// One trip @15:00 → 0 + 190 = 190. Two trips 12:00+15:00 → 180 + 190 = 370.
const WINDOW = { from: "2026-07-06", to: "2026-07-19" };

async function seed(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  for (const c of [crew("crew-quint", "Quint"), crew("crew-hooper", "Hooper"), crew("crew-trainee", "Trainee")]) {
    await repo.saveCrewMember(c);
  }
  // S1: in window, single trip. Quint (required) + Hooper (required) + Trainee (supernumerary).
  await repo.saveEvent(event("e1", "2026-07-10", "15:00"));
  await repo.saveShift(shift("s1", "2026-07-10", ["e1"]));
  await repo.saveSeat(seat("s1-cap", "s1", "crew-quint"));
  await repo.saveSeat(seat("s1-mate", "s1", "crew-hooper"));
  await repo.saveSeat(seat("s1-sup", "s1", "crew-trainee", "supernumerary"));
  // S2: in window, two trips. Quint (required).
  await repo.saveEvent(event("e2a", "2026-07-12", "12:00"));
  await repo.saveEvent(event("e2b", "2026-07-12", "15:00"));
  await repo.saveShift(shift("s2", "2026-07-12", ["e2a", "e2b"]));
  await repo.saveSeat(seat("s2-cap", "s2", "crew-quint"));
  // S3: OUT of window (June). Quint.
  await repo.saveEvent(event("e3", "2026-06-01", "15:00"));
  await repo.saveShift(shift("s3", "2026-06-01", ["e3"]));
  await repo.saveSeat(seat("s3-cap", "s3", "crew-quint"));
  // S4: in window but CANCELLED. Quint.
  await repo.saveEvent(event("e4", "2026-07-11", "15:00"));
  await repo.saveShift(shift("s4", "2026-07-11", ["e4"], "Cancelled"));
  await repo.saveSeat(seat("s4-cap", "s4", "crew-quint"));
  return repo;
}

describe("buildPayrollReport", () => {
  it("sums on-clock minutes per required crew member, in-window, sorted by name", async () => {
    const report = await buildPayrollReport(await seed(), WINDOW);
    expect(report).toEqual([
      { crewMemberId: "crew-hooper", name: "Hooper", shiftCount: 1, minutes: 190 }, // S1 only
      { crewMemberId: "crew-quint", name: "Quint", shiftCount: 2, minutes: 560 }, // S1 190 + S2 370
    ]);
  });

  it("excludes supernumerary (trainee) seats — unpaid", async () => {
    const report = await buildPayrollReport(await seed(), WINDOW);
    expect(report.find((r) => r.crewMemberId === "crew-trainee")).toBeUndefined();
  });

  it("counts a shift once even if the same crew holds two required seats on it (override backstop)", async () => {
    const repo = await seed();
    // The operator override can seat Quint on BOTH required seats of one shift
    // (bypasses the DEC-003 double-book guard). His hours for that shift must not double.
    await repo.saveEvent(event("e5", "2026-07-14", "15:00"));
    await repo.saveShift(shift("s5", "2026-07-14", ["e5"]));
    await repo.saveSeat(seat("s5-a", "s5", "crew-quint"));
    await repo.saveSeat(seat("s5-b", "s5", "crew-quint")); // same person, second required seat
    const quint = (await buildPayrollReport(repo, WINDOW)).find((r) => r.crewMemberId === "crew-quint")!;
    // S1 190 + S2 370 + S5 190 (counted ONCE, not 380) = 750; shiftCount 3, not 4.
    expect(quint).toMatchObject({ shiftCount: 3, minutes: 750 });
  });

  it("skips out-of-window and cancelled shifts", async () => {
    // Quint's S3 (June, out of window) and S4 (cancelled) contribute nothing — his
    // total is exactly S1 + S2.
    const quint = (await buildPayrollReport(await seed(), WINDOW)).find((r) => r.crewMemberId === "crew-quint");
    expect(quint).toMatchObject({ shiftCount: 2, minutes: 560 });
  });
});
