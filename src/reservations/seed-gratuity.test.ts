/**
 * "Match" test for the db:seed:gratuity fixture (12.3b) — a LOOSE drift guard, not a
 * value-pinned snapshot. It asserts the one thing that matters: the world the builder produces
 * is one the payroll report actually SPLITS. This is exactly the invariant the seed itself
 * re-checks at runtime — if an entity shape or the report join drifts so the fixture stops
 * rendering, this goes red.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { buildGratuityPayroll } from "../admin/gratuity-payroll.js";
import { asId } from "../domain/ids.js";
import { buildSeededGratuity } from "./seed-gratuity.js";

const DATE = "2026-07-10";

async function repoWithCrew(ids: string[]) {
  const repo = new InMemoryRepository();
  for (const id of ids) {
    await repo.saveCrewMember({
      id: asId<"CrewMemberId">(id),
      name: id,
      phone: "+15550000001",
      ratings: [asId<"RoleTypeId">("role-captain")],
      status: "active",
      reliabilityScore: null,
    });
  }
  return repo;
}

async function saveWorld(repo: InMemoryRepository, world: ReturnType<typeof buildSeededGratuity>) {
  await repo.saveVessel(world.vessel);
  await repo.saveEvent(world.event);
  await repo.saveShift(world.shift);
  for (const s of world.seats) await repo.saveSeat(s);
  await repo.saveReservation(world.reservation);
  await repo.saveGratuity(world.gratuity);
}

describe("db:seed:gratuity fixture", () => {
  it("builds a crewed trip the payroll splits evenly among its crew", async () => {
    const repo = await repoWithCrew(["crew-a", "crew-b"]);
    const world = buildSeededGratuity({
      crew: [{ id: "crew-a" }, { id: "crew-b" }],
      date: DATE,
      amountCents: 6000,
      bps: 2000,
      createdAt: `${DATE}T12:00:00Z`,
    });
    await saveWorld(repo, world);

    const report = await buildGratuityPayroll(repo, { from: "2026-07-06", to: "2026-07-12" });

    expect(report.totalCents).toBe(6000); // whole pool allocated
    expect(report.rows.map((r) => r.tipCents).sort()).toEqual([3000, 3000]); // even split
  });

  it("re-seeding the same date is idempotent (deterministic ids, no double-count)", async () => {
    const repo = await repoWithCrew(["crew-a"]);
    const a = buildSeededGratuity({ crew: [{ id: "crew-a" }], date: DATE, amountCents: 6000, createdAt: `${DATE}T12:00:00Z` });
    const b = buildSeededGratuity({ crew: [{ id: "crew-a" }], date: DATE, amountCents: 6000, createdAt: `${DATE}T18:00:00Z` });
    expect(b.gratuity.id).toBe(a.gratuity.id);
    expect(b.shift.id).toBe(a.shift.id);
    await saveWorld(repo, a);
    await saveWorld(repo, b);

    const report = await buildGratuityPayroll(repo, { from: "2026-07-06", to: "2026-07-12" });
    expect(report.totalCents).toBe(6000); // upsert, not 12000
  });
});
