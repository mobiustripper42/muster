/**
 * Time punch domain (#625, SPEC §2.9) — clock in / clock out / open-punch lookup.
 *
 * Covers the one-open-punch mutex, the three error codes, and shift auto-match
 * including the case the whole vessel-local rule exists for: an 8pm Eastern punch
 * whose UTC date is already tomorrow (DEC-032). The DATABASE half of the mutex (the
 * partial unique index) is exercised against real Postgres by the repository
 * contract — this file proves the use-case layer's half.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Seat, Shift } from "../domain/entities.js";
import { clockIn, clockOut, openPunchFor } from "./time-clock.js";

const CAP = asId<"RoleTypeId">("role-captain");
const V = asId<"VesselId">("vessel-1");
const QUINT = asId<"CrewMemberId">("crew-quint");
const HOOPER = asId<"CrewMemberId">("crew-hooper");

const crew = (id: string, name: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name,
  phone: "+15035550100",
  ratings: [CAP],
  status: "active",
  reliabilityScore: null,
});

const shift = (id: string, date: string, state: Shift["state"] = "Crewed"): Shift => ({
  id: asId<"ShiftId">(id),
  vesselId: V,
  date,
  state,
  eventIds: [],
});

const seat = (
  id: string,
  shiftId: string,
  assignedTo: string | undefined,
  state: Seat["state"] = "Confirmed",
  kind: Seat["kind"] = "required",
): Seat => ({
  id: asId<"SeatId">(id),
  shiftId: asId<"ShiftId">(shiftId),
  role: CAP,
  kind,
  state,
  ...(assignedTo ? { assignedCrewMemberId: asId<"CrewMemberId">(assignedTo) } : {}),
});

async function seedCrew(repo: InMemoryRepository): Promise<void> {
  await repo.saveCrewMember(crew("crew-quint", "Quint"));
  await repo.saveCrewMember(crew("crew-hooper", "Hooper"));
}

const punchId = (n: string) => asId<"TimePunchId">(`punch-${n}`);

// 2026-07-15 is a Wednesday, EDT (UTC-4). 13:00Z = 9:00 AM Eastern.
const MORNING = new Date("2026-07-15T13:00:00.000Z");
const EVENING = new Date("2026-07-15T21:00:00.000Z");

describe("clockIn", () => {
  it("opens a punch: outAt null, origin crew, and openPunchFor finds it", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);

    const result = await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: MORNING });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch).toMatchObject({
      crewMemberId: QUINT,
      inAt: "2026-07-15T13:00:00.000Z",
      outAt: null,
      origin: "crew",
      adminEditedAt: null,
    });
    expect(await openPunchFor(repo, QUINT)).toMatchObject({ id: punchId("1") });
  });

  it("a second clockIn while one is open returns already_in and creates NOTHING", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: MORNING });

    const second = await clockIn(repo, { id: punchId("2"), crewMemberId: QUINT, at: EVENING });

    expect(second).toEqual({ ok: false, code: "already_in" });
    expect(await repo.listTimePunchesForCrew(QUINT)).toHaveLength(1);
    expect(await repo.getTimePunch(punchId("2"))).toBeNull();
  });

  it("one person's open punch never blocks another's", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: MORNING });

    const other = await clockIn(repo, { id: punchId("2"), crewMemberId: HOOPER, at: MORNING });

    expect(other.ok).toBe(true);
    expect(await openPunchFor(repo, HOOPER)).toMatchObject({ id: punchId("2") });
  });

  it("records origin admin when the admin surface is the one punching (#627)", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);

    const result = await clockIn(repo, {
      id: punchId("1"),
      crewMemberId: QUINT,
      at: MORNING,
      origin: "admin",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.origin).toBe("admin");
  });
});

describe("clockOut", () => {
  it("closes the open punch and stamps outAt", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: MORNING });

    const result = await clockOut(repo, QUINT, EVENING);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.outAt).toBe("2026-07-15T21:00:00.000Z");
    expect(await openPunchFor(repo, QUINT)).toBeNull();
  });

  it("with nothing open returns not_in", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);

    expect(await clockOut(repo, QUINT, EVENING)).toEqual({ ok: false, code: "not_in" });
  });

  it("an outAt BEFORE inAt returns out_before_in and leaves the punch open", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: EVENING });

    const result = await clockOut(repo, QUINT, MORNING);

    expect(result).toEqual({ ok: false, code: "out_before_in" });
    expect(await openPunchFor(repo, QUINT)).toMatchObject({ outAt: null });
  });

  it("an outAt EQUAL to inAt returns out_before_in — a zero-length punch is not a punch", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: MORNING });

    expect(await clockOut(repo, QUINT, MORNING)).toEqual({ ok: false, code: "out_before_in" });
  });
});

describe("shift auto-match", () => {
  it("tags the shift when the person holds exactly one Confirmed required seat that day", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await repo.saveShift(shift("shift-1", "2026-07-15"));
    await repo.saveSeat(seat("seat-1", "shift-1", "crew-quint"));

    const result = await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: MORNING });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.shiftId).toBe(asId<"ShiftId">("shift-1"));
  });

  it("leaves shiftId null when nothing matches — maintenance is still work", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);

    const result = await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: MORNING });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.shiftId).toBeNull();
  });

  it("leaves shiftId null on TWO matches rather than picking one", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await repo.saveShift(shift("shift-1", "2026-07-15"));
    await repo.saveShift(shift("shift-2", "2026-07-15"));
    await repo.saveSeat(seat("seat-1", "shift-1", "crew-quint"));
    await repo.saveSeat(seat("seat-2", "shift-2", "crew-quint"));

    const result = await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: MORNING });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.shiftId).toBeNull();
  });

  it("ignores a seat that isn't Confirmed, isn't required, or isn't theirs", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await repo.saveShift(shift("shift-1", "2026-07-15"));
    await repo.saveShift(shift("shift-2", "2026-07-15"));
    await repo.saveShift(shift("shift-3", "2026-07-15"));
    await repo.saveSeat(seat("seat-1", "shift-1", "crew-quint", "Claimed"));
    await repo.saveSeat(seat("seat-2", "shift-2", "crew-quint", "Confirmed", "supernumerary"));
    await repo.saveSeat(seat("seat-3", "shift-3", "crew-hooper"));

    const result = await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: MORNING });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.shiftId).toBeNull();
  });

  it("ignores a Cancelled shift — nobody is crewing it", async () => {
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await repo.saveShift(shift("shift-1", "2026-07-15", "Cancelled"));
    await repo.saveSeat(seat("seat-1", "shift-1", "crew-quint"));

    const result = await clockIn(repo, { id: punchId("1"), crewMemberId: QUINT, at: MORNING });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.shiftId).toBeNull();
  });

  it("matches on the VESSEL-LOCAL date: an 8pm Eastern punch is still today's shift (DEC-032)", async () => {
    // 2026-07-16T00:00:00Z is 8pm EDT on 2026-07-15. Bucketing on the UTC date
    // would tag the 16th's shift — someone else's boat, and the wrong paycheck.
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await repo.saveShift(shift("shift-15th", "2026-07-15"));
    await repo.saveShift(shift("shift-16th", "2026-07-16"));
    await repo.saveSeat(seat("seat-15th", "shift-15th", "crew-quint"));
    await repo.saveSeat(seat("seat-16th", "shift-16th", "crew-quint"));

    const result = await clockIn(repo, {
      id: punchId("1"),
      crewMemberId: QUINT,
      at: new Date("2026-07-16T00:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.punch.shiftId).toBe(asId<"ShiftId">("shift-15th"));
  });
});

describe("elapsed time is measured between instants", () => {
  it("a punch spanning the fall-back transition reports TRUE elapsed minutes", async () => {
    // 2026-11-01: EDT→EST at 02:00 local. 01:00 EDT (05:00Z) → 03:00 EST (08:00Z)
    // is 3 real hours, though the wall clock only advanced 2.
    const repo = new InMemoryRepository();
    await seedCrew(repo);
    await clockIn(repo, {
      id: punchId("1"),
      crewMemberId: QUINT,
      at: new Date("2026-11-01T05:00:00.000Z"),
    });

    const result = await clockOut(repo, QUINT, new Date("2026-11-01T08:00:00.000Z"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const elapsed =
      (Date.parse(result.punch.outAt!) - Date.parse(result.punch.inAt)) / 60_000;
    expect(elapsed).toBe(180);
  });
});
