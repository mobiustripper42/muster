/**
 * saveVesselAdmin (task 12.9) — validation + the preserve-crew-engine-fields contract.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Location, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { saveVesselAdmin } from "./vessel-admin.js";

const LOC = asId<"LocationId">("loc-1");
const location = (): Location => ({
  id: LOC,
  name: "East Bank",
  pickupDescription: "Dock 3",
  routeDescription: "Up the river",
});

const captain = asId<"RoleTypeId">("role-captain");
const mate = asId<"RoleTypeId">("role-mate");
const existingVessel = (over: Partial<Vessel> = {}): Vessel => ({
  id: asId<"VesselId">("vessel-1"),
  name: "Brew 1",
  coiMaxPax: 12,
  manning: [{ roleTypeId: captain, count: 1 }],
  ...over,
});

async function repoWithLocation() {
  const repo = new InMemoryRepository();
  await repo.saveLocation(location());
  // The crew rule references role rows, and `saveVesselAdmin` refuses one that names a role with
  // no row (#861) — the same existence check the home Location already gets.
  const tenantId = asId<"TenantId">("tenant-brewboat");
  await repo.saveRoleType({ id: captain, tenantId, name: "captain" });
  await repo.saveRoleType({ id: mate, tenantId, name: "mate" });
  return repo;
}

describe("saveVesselAdmin — validation", () => {
  const base = { id: "vessel-new", name: "Brew X", coiMaxPax: 12 };

  it("rejects a blank name", async () => {
    const r = await saveVesselAdmin(new InMemoryRepository(), { ...base, name: "  " });
    expect(r).toEqual({ ok: false, code: "name_required" });
  });

  it("refuses a boat with no required crew (#861)", async () => {
    // **The screen used to give a new boat an empty crew rule and there was nowhere to fix it.**
    // `deriveSeats` iterates `vessel.manning`, so no rule means no seats: no ask fires, the
    // At-Risk board derives no gap so the row is dropped, and `claimableSeatsFor` excludes it.
    // Since #582 an empty required-seat set throws rather than reading as vacuously crewed — so
    // a boat saved without a crew rule now breaks the shifts board instead of lying on it.
    //
    // Refused at the door, which is the only place it can be refused: this is the sole writer
    // reachable from the app, and the crew-engine tooling that used to be the answer
    // (`addManningSeat`) is a withdrawn stub that redirects.
    for (const manning of [[], undefined]) {
      const r = await saveVesselAdmin(new InMemoryRepository(), {
        ...base,
        ...(manning === undefined ? {} : { manning }),
      });
      expect(r).toEqual({ ok: false, code: "crew_required" });
    }
  });

  it("refuses a role that demands nobody, and one that isn't a whole person", async () => {
    for (const count of [0, -1, 1.5]) {
      const r = await saveVesselAdmin(new InMemoryRepository(), {
        ...base,
        manning: [{ roleTypeId: captain, count }],
      });
      expect(r).toEqual({ ok: false, code: "bad_crew_count" });
    }
  });

  it("rejects a non-integer or out-of-range capacity", async () => {
    for (const coiMaxPax of [0, 100, 6.5, NaN]) {
      const r = await saveVesselAdmin(new InMemoryRepository(), { ...base, coiMaxPax });
      expect(r).toEqual({ ok: false, code: "bad_capacity" });
    }
  });

  it("rejects a hue outside the palette", async () => {
    for (const hue of [0, 7, 2.5]) {
      const r = await saveVesselAdmin(new InMemoryRepository(), { ...base, hue });
      expect(r).toEqual({ ok: false, code: "bad_hue" });
    }
  });

  it("rejects a home location that doesn't exist", async () => {
    const r = await saveVesselAdmin(new InMemoryRepository(), {
      ...base,
      homeLocationId: "loc-nope",
    });
    expect(r).toEqual({ ok: false, code: "bad_location" });
  });

  it("refuses a role that has no row", async () => {
    // Same shape as the home-Location check above, and for the same reason: a picker cannot
    // offer a role that does not exist, but the posted body is whatever the client sent. A
    // manning entry naming a missing role derives a seat nothing can fill, which reads on the
    // board as a boat permanently short of crew rather than as a bad save.
    const repo = await repoWithLocation();
    const r = await saveVesselAdmin(repo, {
      ...base,
      manning: [{ roleTypeId: asId<"RoleTypeId">("role-deckhand"), count: 1 }],
    });
    expect(r).toEqual({ ok: false, code: "unknown_role" });
  });

  // Was "defaults manning to empty" — the default this asserted is what #861 removed. A create
  // now has to say who sails the boat, and the assertion moved from `manning: []` to the rule
  // the caller passed.
  it("accepts a valid create — trims name, stores the crew rule", async () => {
    const repo = await repoWithLocation();
    const r = await saveVesselAdmin(repo, {
      id: "vessel-new",
      name: "  Brew X  ",
      coiMaxPax: 16,
      hue: 3,
      homeLocationId: "loc-1",
      notes: "  big deck  ",
      manning: [
        { roleTypeId: captain, count: 1 },
        { roleTypeId: mate, count: 2 },
      ],
    });
    expect(r).toEqual({ ok: true, id: "vessel-new" });
    const saved = await repo.getVessel(asId<"VesselId">("vessel-new"));
    expect(saved).toMatchObject({
      name: "Brew X",
      coiMaxPax: 16,
      hue: 3,
      homeLocationId: "loc-1",
      notes: "big deck",
      manning: [
        { roleTypeId: captain, count: 1 },
        { roleTypeId: mate, count: 2 },
      ],
    });
  });
});

describe("saveVesselAdmin — editing the crew rule", () => {
  // Replaces "keeps the manning the form never carries". The form carries it now, so preserving
  // it against the form would be the bug — an operator who removes the mate must get a boat
  // with no mate. What still has to hold is that a NON-empty rule replaces the stored one
  // wholesale rather than merging with it.
  it("replaces the stored crew rule with the one posted", async () => {
    const repo = await repoWithLocation();
    await repo.saveVessel(existingVessel({ manning: [
      { roleTypeId: captain, count: 1 },
      { roleTypeId: mate, count: 1 },
    ] }));

    const r = await saveVesselAdmin(repo, {
      id: "vessel-1",
      name: "Brew 1 renamed",
      coiMaxPax: 14,
      hue: 2,
      manning: [{ roleTypeId: captain, count: 1 }], // the mate is removed
    });
    expect(r.ok).toBe(true);

    const saved = await repo.getVessel(asId<"VesselId">("vessel-1"));
    expect(saved).toMatchObject({ name: "Brew 1 renamed", coiMaxPax: 14, hue: 2 });
    expect(saved?.manning).toEqual([{ roleTypeId: captain, count: 1 }]);
  });

  it("refuses to empty the crew rule of a boat that has one", async () => {
    // The edit direction of the same guard. A boat that sails today must not be edited into one
    // that derives no seats — which since #582 does not render as uncrewed, it throws.
    const repo = await repoWithLocation();
    await repo.saveVessel(existingVessel());

    const r = await saveVesselAdmin(repo, { id: "vessel-1", name: "Brew 1", coiMaxPax: 12 });
    expect(r).toEqual({ ok: false, code: "crew_required" });
    const saved = await repo.getVessel(asId<"VesselId">("vessel-1"));
    expect(saved?.manning).toEqual([{ roleTypeId: captain, count: 1 }]); // untouched
  });

  it("clears an optional field when the form omits it (hue/home/notes)", async () => {
    const repo = await repoWithLocation();
    await repo.saveVessel(existingVessel({ hue: 4, notes: "old" }));

    await saveVesselAdmin(repo, {
      id: "vessel-1",
      name: "Brew 1",
      coiMaxPax: 12,
      manning: [{ roleTypeId: captain, count: 1 }],
    });
    const saved = await repo.getVessel(asId<"VesselId">("vessel-1"));
    expect(saved?.hue).toBeUndefined();
    expect(saved?.notes).toBeUndefined();
  });
});
