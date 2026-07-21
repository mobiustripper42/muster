/**
 * saveOfferingAdmin (task 12.8) — validation, error codes, cross-entity checks, and the
 * preserve-tenant-on-edit contract. Mirrors vessel-admin.test.ts.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { AddOn, Location, Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { saveOfferingAdmin, type OfferingAdminInput } from "./offering-admin.js";

const LOC = asId<"LocationId">("loc-1");
const BOAT = asId<"VesselId">("vessel-1");
const ADDON = asId<"AddOnId">("addon-1");
const TENANT = asId<"TenantId">("tenant-brewboat");

const location = (): Location => ({
  id: LOC,
  name: "East Bank",
  pickupDescription: "Dock 3",
  routeDescription: "Up the river",
});
const vessel = (): Vessel => ({ id: BOAT, name: "Brew 1", coiMaxPax: 12, manning: [] });
const addOn = (): AddOn => ({
  id: ADDON,
  tenantId: TENANT,
  label: "Extra hour",
  type: "flat",
  amountCents: 15000,
  required: false,
  active: true,
});

async function seededRepo(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveLocation(location());
  await repo.saveVessel(vessel());
  await repo.saveAddOn(addOn());
  return repo;
}

const base = (): OfferingAdminInput => ({
  id: "offering-new",
  tenantId: "tenant-brewboat",
  name: "Party Boats with Captain",
  status: "draft",
  locationId: "loc-1",
  vesselIds: ["vessel-1"],
  schedule: {
    seasonStart: "2026-05-01",
    seasonEnd: "2026-09-30",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    departureTimes: ["11:30", "13:30"],
  },
  basePriceCents: 49900,
  extraGuestPriceCents: 4000,
  priceVariations: [],
});

describe("saveOfferingAdmin — validation", () => {
  it("rejects a blank name", async () => {
    const r = await saveOfferingAdmin(await seededRepo(), { ...base(), name: "  " });
    expect(r).toEqual({ ok: false, code: "name_required" });
  });

  it("rejects an unknown status", async () => {
    const r = await saveOfferingAdmin(await seededRepo(), { ...base(), status: "archived" });
    expect(r).toEqual({ ok: false, code: "bad_status" });
  });

  it("rejects a location that doesn't exist (and a blank one)", async () => {
    const repo = await seededRepo();
    expect(await saveOfferingAdmin(repo, { ...base(), locationId: "loc-nope" })).toEqual({
      ok: false,
      code: "bad_location",
    });
    expect(await saveOfferingAdmin(repo, { ...base(), locationId: "" })).toEqual({
      ok: false,
      code: "bad_location",
    });
  });

  it("rejects an empty vessel set and an unknown vessel", async () => {
    const repo = await seededRepo();
    expect(await saveOfferingAdmin(repo, { ...base(), vesselIds: [] })).toEqual({
      ok: false,
      code: "bad_vessels",
    });
    expect(
      await saveOfferingAdmin(repo, { ...base(), vesselIds: ["vessel-1", "vessel-nope"] }),
    ).toEqual({ ok: false, code: "bad_vessels" });
  });

  it("rejects a malformed schedule", async () => {
    const repo = await seededRepo();
    const bad = [
      { seasonStart: "2026-13-01" }, // not a real month
      { seasonStart: "2026-09-30", seasonEnd: "2026-05-01" }, // reversed season
      { weekdays: [7] }, // out of range
      { weekdays: [1, 1] }, // duplicate
      { departureTimes: ["25:00"] }, // not a clock time
      { departureTimes: ["11:30", "11:30"] }, // duplicate
    ];
    for (const over of bad) {
      const r = await saveOfferingAdmin(repo, {
        ...base(),
        schedule: { ...base().schedule, ...over },
      });
      expect(r).toEqual({ ok: false, code: "bad_schedule" });
    }
  });

  it("rejects non-integer or negative money", async () => {
    const repo = await seededRepo();
    expect(await saveOfferingAdmin(repo, { ...base(), basePriceCents: 499.5 })).toEqual({
      ok: false,
      code: "bad_price",
    });
    expect(await saveOfferingAdmin(repo, { ...base(), extraGuestPriceCents: -1 })).toEqual({
      ok: false,
      code: "bad_price",
    });
  });

  it("rejects a bad included-guest count and bad minutes", async () => {
    const repo = await seededRepo();
    expect(await saveOfferingAdmin(repo, { ...base(), includedGuestCount: 0 })).toEqual({
      ok: false,
      code: "bad_included_guests",
    });
    expect(await saveOfferingAdmin(repo, { ...base(), tripLengthMinutes: 1.5 })).toEqual({
      ok: false,
      code: "bad_minutes",
    });
    expect(await saveOfferingAdmin(repo, { ...base(), holdMinutes: -10 })).toEqual({
      ok: false,
      code: "bad_minutes",
    });
  });

  it("rejects an included-guest count above the smallest picked vessel's capacity", async () => {
    const repo = await seededRepo(); // BOAT = coiMaxPax 12
    expect(await saveOfferingAdmin(repo, { ...base(), includedGuestCount: 13 })).toEqual({
      ok: false,
      code: "included_over_capacity",
    });
    // At capacity is fine (whole boat included, no extras).
    expect((await saveOfferingAdmin(repo, { ...base(), includedGuestCount: 12 })).ok).toBe(true);
  });

  it("rejects malformed price variations", async () => {
    const repo = await seededRepo();
    const bad = [
      { label: " ", applies: { kind: "date" as const, date: "2026-07-04" }, adjustment: { kind: "flatCents" as const, deltaCents: 100 } },
      { label: "x", applies: { kind: "weekdays" as const, weekdays: [] }, adjustment: { kind: "flatCents" as const, deltaCents: 100 } },
      { label: "x", applies: { kind: "dateRange" as const, start: "2026-08-01", end: "2026-07-01" }, adjustment: { kind: "flatCents" as const, deltaCents: 100 } },
      { label: "x", applies: { kind: "date" as const, date: "2026-07-04" }, adjustment: { kind: "flatCents" as const, deltaCents: 0.5 } },
      { label: "x", applies: { kind: "date" as const, date: "2026-07-04" }, adjustment: { kind: "percent" as const, percent: -100 } },
    ];
    for (const v of bad) {
      const r = await saveOfferingAdmin(repo, { ...base(), priceVariations: [v] });
      expect(r).toEqual({ ok: false, code: "bad_variations" });
    }
  });

  it("rejects a malformed gratuity config", async () => {
    const repo = await seededRepo();
    const cases = [
      [{ kind: "mid" as never, tiersBps: [2000], defaultBps: 2000, required: true }],
      [
        { kind: "pre" as const, tiersBps: [2000], defaultBps: 2000, required: true },
        { kind: "pre" as const, tiersBps: [1500], defaultBps: 1500, required: true },
      ], // duplicate kind
      [{ kind: "pre" as const, tiersBps: [], defaultBps: 2000, required: true }], // no tiers
      [{ kind: "pre" as const, tiersBps: [1500, 2500], defaultBps: 2000, required: true }], // default ∉ tiers
      [{ kind: "post" as const, tiersBps: [0], defaultBps: 0, required: false }], // zero tier
    ];
    for (const gratuityKinds of cases) {
      const r = await saveOfferingAdmin(repo, { ...base(), gratuityKinds });
      expect(r).toEqual({ ok: false, code: "bad_gratuity" });
    }
  });

  it("rejects an unknown add-on id (#491)", async () => {
    const repo = await seededRepo();
    expect(await saveOfferingAdmin(repo, { ...base(), addOnIds: ["addon-1", "addon-nope"] })).toEqual({
      ok: false,
      code: "bad_add_ons",
    });
  });
});

describe("saveOfferingAdmin — persistence", () => {
  it("accepts a full create — trims, keeps variation order, stores every section", async () => {
    const repo = await seededRepo();
    const r = await saveOfferingAdmin(repo, {
      ...base(),
      name: "  Party Boats  ",
      status: "live",
      description: "  **NO Pedaling Required** on any of our Brew Boats  ",
      tripLengthMinutes: 100,
      holdMinutes: 100,
      arriveBeforeMinutes: 15,
      includedGuestCount: 10,
      priceVariations: [
        { label: "July 4th", applies: { kind: "date", date: "2026-07-04" }, adjustment: { kind: "flatCents", deltaCents: 10000 } },
        { label: "Sunday", applies: { kind: "weekdays", weekdays: [6] }, adjustment: { kind: "percent", percent: -20 } },
      ],
      gratuityKinds: [
        { kind: "pre", tiersBps: [1500, 2000, 2500], defaultBps: 2000, required: true },
        { kind: "post", tiersBps: [1500, 2000, 2500], defaultBps: 2000, required: false },
      ],
      addOnIds: ["addon-1"],
    });
    expect(r).toEqual({ ok: true, id: "offering-new" });

    const saved = (await repo.getOffering(asId<"OfferingId">("offering-new")))!;
    expect(saved).toMatchObject({
      tenantId: TENANT,
      name: "Party Boats",
      status: "live",
      description: "**NO Pedaling Required** on any of our Brew Boats",
      vesselIds: [BOAT],
      locationId: LOC,
      tripLengthMinutes: 100,
      holdMinutes: 100,
      arriveBeforeMinutes: 15,
      includedGuestCount: 10,
      basePriceCents: 49900,
      extraGuestPriceCents: 4000,
    });
    // Order IS the rule (first match wins) — July 4th stays above Sunday.
    expect(saved.priceVariations.map((v) => v.label)).toEqual(["July 4th", "Sunday"]);
    expect(saved.gratuityKinds).toHaveLength(2);
    expect(saved.addOnIds).toEqual([ADDON]);
  });

  it("omits unset optionals (no undefined assignments, no empty add-on-id list)", async () => {
    const repo = await seededRepo();
    await saveOfferingAdmin(repo, { ...base(), addOnIds: [] });
    const saved = (await repo.getOffering(asId<"OfferingId">("offering-new")))!;
    for (const k of ["description", "tripLengthMinutes", "holdMinutes", "arriveBeforeMinutes", "includedGuestCount", "gratuityKinds", "addOnIds"]) {
      expect(k in saved).toBe(false);
    }
  });

  it("preserves the existing row's tenant on an edit (the form never carries it)", async () => {
    const repo = await seededRepo();
    const otherTenant = asId<"TenantId">("tenant-other");
    const existing: Offering = {
      id: asId<"OfferingId">("offering-1"),
      tenantId: otherTenant,
      name: "Old name",
      status: "live",
      vesselIds: [BOAT],
      locationId: LOC,
      schedule: { seasonStart: "2026-05-01", seasonEnd: "2026-09-30", weekdays: [5], departureTimes: ["11:30"] },
      basePriceCents: 49900,
      priceVariations: [],
      extraGuestPriceCents: 4000,
    };
    await repo.saveOffering(existing);

    const r = await saveOfferingAdmin(repo, { ...base(), id: "offering-1", name: "New name" });
    expect(r.ok).toBe(true);
    const saved = (await repo.getOffering(existing.id))!;
    expect(saved.name).toBe("New name");
    expect(saved.tenantId).toBe(otherTenant); // NOT the caller's tenant-brewboat
  });

  it("hidden is a status flip, not a delete — the row survives with references intact", async () => {
    const repo = await seededRepo();
    await saveOfferingAdmin(repo, base());
    const r = await saveOfferingAdmin(repo, { ...base(), status: "hidden" });
    expect(r.ok).toBe(true);
    const saved = (await repo.getOffering(asId<"OfferingId">("offering-new")))!;
    expect(saved.status).toBe("hidden");
    expect(saved.vesselIds).toEqual([BOAT]); // everything else kept
  });
});
