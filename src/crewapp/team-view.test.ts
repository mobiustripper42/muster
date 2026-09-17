/**
 * The team-schedule view (#968) — the display-only section below `/crew/open`'s
 * claim list. Asserts the crew-facing narrowing of `deriveAllShifts`: boats, days
 * and who is aboard, and NOTHING that ranks or exposes a person (DEC-008) or a
 * guest (the `other-shifts.ts` PII boundary).
 *
 * The blank screen this exists to kill is the first case: a fully-crewed fleet has
 * nothing claimable, and today that renders as "Nothing open in this window".
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Seat, Shift } from "../domain/entities.js";
import type { SeatState } from "../domain/states.js";
import { buildTeamView } from "./team-view.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const TENANT = asId<"TenantId">("tenant-test");
const NOW = new Date("2026-07-03T12:00:00.000Z");
const WEEK = { from: "2026-07-03", to: "2026-07-10" };

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

/** Mirrors the `other-shifts.test.ts` fixture — one boat, one shift, N trips. */
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

describe("buildTeamView (#968)", () => {
  it("returns the fleet's boats and crew names when nothing is claimable — the blank screen this replaces", async () => {
    await addShift("orca-fri", "2026-07-03", "Orca", ["10:00"], [
      { state: "Confirmed", crew: { id: "crew-bo", name: "Bo" } },
    ], "Crewed");
    await addShift("hops-sat", "2026-07-04", "Hops", ["17:00", "19:00"], [
      { state: "Confirmed", crew: { id: "crew-quint", name: "Quint" } },
      { role: MATE, state: "Confirmed", crew: { id: "crew-ani", name: "Ani" } },
    ], "Crewed");

    const rows = await buildTeamView(repo, WEEK, NOW);

    expect(rows.map((r) => r.shiftId)).toEqual(["orca-fri", "hops-sat"]);
    expect(rows[0]).toEqual({
      shiftId: "orca-fri",
      vesselId: "vessel-orca-fri",
      vesselName: "Orca",
      date: "2026-07-03",
      firstDeparture: "10:00",
      tripCount: 1,
      crew: [{ name: "Bo", role: "captain" }],
      openRoles: [],
    });
    // The board's deterministic seat order (roleName ascending), inherited from
    // `deriveAllShifts` — same as `other-shifts.ts`. Captain before mate.
    expect(rows[1]!.crew).toEqual([
      { name: "Quint", role: "captain" },
      { name: "Ani", role: "mate" },
    ]);
    expect(rows[1]!.tripCount).toBe(2);
  });

  it("carries no guest count, no shift state, and no split suggestion", async () => {
    await addShift("orca-fri", "2026-07-03", "Orca", ["10:00"], [
      { state: "Confirmed", crew: { id: "crew-bo", name: "Bo" } },
    ], "Crewed");

    const [row] = await buildTeamView(repo, WEEK, NOW);

    // Asserted on the VALUE, not just the type — a projection that forwards an
    // extra field typechecks fine against a narrower interface at the call site.
    const keys = Object.keys(row!).sort();
    expect(keys).toEqual([
      "crew",
      "date",
      "firstDeparture",
      "openRoles",
      "shiftId",
      "tripCount",
      "vesselId",
      "vesselName",
    ]);
  });

  it("renders an Asked seat exactly like an unfilled one — the ask trail never reaches crew (DEC-008)", async () => {
    await addShift("asked", "2026-07-03", "Orca", ["10:00"], [
      { state: "Asked", crew: { id: "crew-bo", name: "Bo" } },
    ]);
    await addShift("untouched", "2026-07-04", "Hops", ["10:00"], [{ state: "Open" }]);

    const rows = await buildTeamView(repo, WEEK, NOW);

    expect(rows[0]!.crew).toEqual([]);
    expect(rows[0]!.openRoles).toEqual(["captain"]);
    expect(rows[1]!.crew).toEqual([]);
    expect(rows[1]!.openRoles).toEqual(["captain"]);
  });

  it("contributes no name for a Claimed-but-not-Confirmed seat (the DEC-075 confirm-gate seam)", async () => {
    await addShift("held", "2026-07-03", "Orca", ["10:00"], [
      { state: "Claimed", crew: { id: "crew-bo", name: "Bo" } },
    ]);

    const [row] = await buildTeamView(repo, WEEK, NOW);

    expect(row!.crew).toEqual([]);
    expect(row!.openRoles).toEqual(["captain"]);
  });

  it("narrows to the given range, and drops cancelled boats", async () => {
    await addShift("in", "2026-07-04", "Orca", ["10:00"], [
      { state: "Confirmed", crew: { id: "crew-bo", name: "Bo" } },
    ]);
    await addShift("out", "2026-07-20", "Hops", ["10:00"], [
      { state: "Confirmed", crew: { id: "crew-q", name: "Quint" } },
    ]);
    await addShift("dead", "2026-07-05", "Firkin", ["10:00"], [
      { state: "Confirmed", crew: { id: "crew-a", name: "Ani" } },
    ], "Cancelled");

    const rows = await buildTeamView(repo, WEEK, NOW);

    expect(rows.map((r) => r.shiftId)).toEqual(["in"]);
  });
});
