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
  return repo;
}

describe("saveVesselAdmin — validation", () => {
  const base = { id: "vessel-new", name: "Brew X", coiMaxPax: 12 };

  it("rejects a blank name", async () => {
    const r = await saveVesselAdmin(new InMemoryRepository(), { ...base, name: "  " });
    expect(r).toEqual({ ok: false, code: "name_required" });
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

  it("accepts a valid create — trims name, defaults manning to empty", async () => {
    const repo = await repoWithLocation();
    const r = await saveVesselAdmin(repo, {
      id: "vessel-new",
      name: "  Brew X  ",
      coiMaxPax: 16,
      hue: 3,
      homeLocationId: "loc-1",
      notes: "  big deck  ",
    });
    expect(r).toEqual({ ok: true, id: "vessel-new" });
    const saved = await repo.getVessel(asId<"VesselId">("vessel-new"));
    expect(saved).toMatchObject({
      name: "Brew X",
      coiMaxPax: 16,
      hue: 3,
      homeLocationId: "loc-1",
      notes: "big deck",
      manning: [],
    });
  });
});

describe("saveVesselAdmin — preserves crew-engine fields on edit", () => {
  it("keeps manning + includedGuestCount the form never carries", async () => {
    const repo = await repoWithLocation();
    await repo.saveVessel(existingVessel({ includedGuestCount: 8 }));

    const r = await saveVesselAdmin(repo, {
      id: "vessel-1",
      name: "Brew 1 renamed",
      coiMaxPax: 14,
      hue: 2,
    });
    expect(r.ok).toBe(true);

    const saved = await repo.getVessel(asId<"VesselId">("vessel-1"));
    expect(saved).toMatchObject({
      name: "Brew 1 renamed",
      coiMaxPax: 14,
      hue: 2,
      includedGuestCount: 8, // preserved — not on the form
      manning: [{ roleTypeId: captain, count: 1 }], // preserved
    });
  });

  it("clears an optional field when the form omits it (hue/home/notes)", async () => {
    const repo = await repoWithLocation();
    await repo.saveVessel(existingVessel({ hue: 4, notes: "old" }));

    await saveVesselAdmin(repo, { id: "vessel-1", name: "Brew 1", coiMaxPax: 12 });
    const saved = await repo.getVessel(asId<"VesselId">("vessel-1"));
    expect(saved?.hue).toBeUndefined();
    expect(saved?.notes).toBeUndefined();
  });
});
