/**
 * saveBlockAdmin / removeBlockAdmin (task 12.10, DEC-125) — validation + the lift path.
 * Dates/times are text, so the door owns integrity (ISO day, ordered range, HH:MM window,
 * cross-entity existence). Only the two scoped kinds are creatable here; vesselHold is a
 * calendar concern → `bad_kind`.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Location, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { removeBlockAdmin, saveBlockAdmin } from "./block-admin.js";

const LOC = asId<"LocationId">("loc-1");
const VESSEL = asId<"VesselId">("vessel-1");

const location = (): Location => ({
  id: LOC,
  name: "East Bank",
  pickupDescription: "Dock 3",
  routeDescription: "Up the river",
});
const vessel = (): Vessel => ({
  id: VESSEL,
  name: "Brew 1",
  coiMaxPax: 12,
  manning: [],
});

async function repoWithEntities() {
  const repo = new InMemoryRepository();
  await repo.saveLocation(location());
  await repo.saveVessel(vessel());
  return repo;
}

describe("saveBlockAdmin — location kind", () => {
  const base = {
    id: "blk-loc",
    kind: "location",
    locationId: "loc-1",
    date: "2026-08-12",
    startTime: "13:00",
    endTime: "18:00",
  };

  it("accepts a valid location block, trims + keeps the note", async () => {
    const repo = await repoWithEntities();
    const r = await saveBlockAdmin(repo, { ...base, note: "  river closed  " });
    expect(r).toEqual({ ok: true, id: "blk-loc" });
    const saved = (await repo.listBlocks())[0];
    expect(saved).toMatchObject({
      kind: "location",
      locationId: "loc-1",
      date: "2026-08-12",
      startTime: "13:00",
      endTime: "18:00",
      note: "river closed",
    });
  });

  it("rejects a location that doesn't exist", async () => {
    const repo = await repoWithEntities();
    const r = await saveBlockAdmin(repo, { ...base, locationId: "loc-nope" });
    expect(r).toEqual({ ok: false, code: "bad_location" });
  });

  it("rejects a blank/missing location", async () => {
    const repo = await repoWithEntities();
    const r = await saveBlockAdmin(repo, { ...base, locationId: "  " });
    expect(r).toEqual({ ok: false, code: "bad_location" });
  });

  it("rejects an unreal ISO day", async () => {
    const repo = await repoWithEntities();
    for (const date of ["2026-02-31", "2026-13-01", "not-a-date", "2026-8-12"]) {
      const r = await saveBlockAdmin(repo, { ...base, date });
      expect(r).toEqual({ ok: false, code: "bad_date" });
    }
  });

  it("rejects a bad or inverted time window", async () => {
    const repo = await repoWithEntities();
    for (const [startTime, endTime] of [
      ["18:00", "13:00"], // inverted
      ["25:00", "26:00"], // not HH:MM
      ["13:00", ""], // missing end
    ] as const) {
      const r = await saveBlockAdmin(repo, { ...base, startTime, endTime });
      expect(r).toEqual({ ok: false, code: "bad_window" });
    }
  });

  it("allows an equal start/end window (a single instant is still a valid window)", async () => {
    const repo = await repoWithEntities();
    const r = await saveBlockAdmin(repo, { ...base, startTime: "13:00", endTime: "13:00" });
    expect(r.ok).toBe(true);
  });
});

describe("saveBlockAdmin — vessel kind", () => {
  const base = {
    id: "blk-ves",
    kind: "vessel",
    vesselId: "vessel-1",
    startDate: "2026-08-11",
    endDate: "2026-08-14",
  };

  it("accepts a valid vessel block", async () => {
    const repo = await repoWithEntities();
    const r = await saveBlockAdmin(repo, base);
    expect(r).toEqual({ ok: true, id: "blk-ves" });
    expect((await repo.listBlocks())[0]).toMatchObject({
      kind: "vessel",
      vesselId: "vessel-1",
      startDate: "2026-08-11",
      endDate: "2026-08-14",
    });
  });

  it("rejects a vessel that doesn't exist", async () => {
    const repo = await repoWithEntities();
    const r = await saveBlockAdmin(repo, { ...base, vesselId: "vessel-nope" });
    expect(r).toEqual({ ok: false, code: "bad_vessel" });
  });

  it("rejects an inverted or unreal date range", async () => {
    const repo = await repoWithEntities();
    for (const [startDate, endDate] of [
      ["2026-08-14", "2026-08-11"], // inverted
      ["2026-02-31", "2026-03-01"], // unreal start
    ] as const) {
      const r = await saveBlockAdmin(repo, { ...base, startDate, endDate });
      expect(r).toEqual({ ok: false, code: "bad_range" });
    }
  });
});

describe("saveBlockAdmin — kind gate", () => {
  it("refuses vesselHold (calendar-made) and any unknown kind", async () => {
    const repo = await repoWithEntities();
    for (const kind of ["vesselHold", "", "location-ish"]) {
      const r = await saveBlockAdmin(repo, {
        id: "blk-x",
        kind,
        vesselId: "vessel-1",
        date: "2026-08-12",
      });
      expect(r).toEqual({ ok: false, code: "bad_kind" });
    }
    expect(await repo.listBlocks()).toHaveLength(0);
  });
});

describe("removeBlockAdmin — lift", () => {
  it("lifts an existing block", async () => {
    const repo = await repoWithEntities();
    await saveBlockAdmin(repo, {
      id: "blk-ves",
      kind: "vessel",
      vesselId: "vessel-1",
      startDate: "2026-08-11",
      endDate: "2026-08-14",
    });
    expect(await repo.listBlocks()).toHaveLength(1);

    const r = await removeBlockAdmin(repo, "blk-ves");
    expect(r).toEqual({ ok: true });
    expect(await repo.listBlocks()).toHaveLength(0);
  });

  it("reports not_found for an id that's already gone", async () => {
    const repo = await repoWithEntities();
    const r = await removeBlockAdmin(repo, "blk-missing");
    expect(r).toEqual({ ok: false, code: "not_found" });
  });
});
