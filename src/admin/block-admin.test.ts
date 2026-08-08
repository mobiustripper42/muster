/**
 * saveBlockAdmin / removeBlockAdmin (task 12.10, DEC-125) — validation + the lift path.
 * Dates/times are text, so the door owns integrity (ISO day, ordered range, HH:MM window,
 * cross-entity existence). Only the two scoped kinds are creatable here; vesselHold is a
 * calendar concern → `bad_kind`.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event, Location, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import {
  releaseVesselHoldAdmin,
  removeBlockAdmin,
  saveBlockAdmin,
  saveVesselHoldAdmin,
} from "./block-admin.js";

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

/**
 * The calendar's own door (#703). `saveBlockAdmin` refuses `vesselHold` on purpose, so the
 * single-slot hold gets a separate entry point — same `{ ok }` idiom, its own error codes.
 * The two doors stay apart so a hand-posted form on /admin/blocks still can't mint a hold.
 */
const scheduledEvent = (over: Partial<Event> = {}): Event => ({
  id: asId<"EventId">("evt-1"),
  vesselId: VESSEL,
  date: "2026-08-12",
  time: "13:30",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  ...over,
});

describe("saveVesselHoldAdmin — the calendar's single-slot hold", () => {
  const base = { id: "hold-1", vesselId: "vessel-1", date: "2026-08-12", time: "13:30" };

  it("writes a vesselHold on the exact slot", async () => {
    const repo = await repoWithEntities();
    const r = await saveVesselHoldAdmin(repo, base);
    expect(r).toEqual({ ok: true, id: "hold-1" });
    expect((await repo.listBlocks())[0]).toEqual({
      id: "hold-1",
      kind: "vesselHold",
      vesselId: "vessel-1",
      date: "2026-08-12",
      time: "13:30",
    });
  });

  it("rejects a vessel that doesn't exist", async () => {
    const repo = await repoWithEntities();
    const r = await saveVesselHoldAdmin(repo, { ...base, vesselId: "vessel-gone" });
    expect(r).toEqual({ ok: false, code: "bad_vessel" });
    expect(await repo.listBlocks()).toHaveLength(0);
  });

  it("rejects an unreal ISO day", async () => {
    const repo = await repoWithEntities();
    for (const date of ["2026-02-31", "12/08/2026", ""]) {
      expect(await saveVesselHoldAdmin(repo, { ...base, date })).toEqual({
        ok: false,
        code: "bad_date",
      });
    }
    expect(await repo.listBlocks()).toHaveLength(0);
  });

  it("rejects a time that isn't HH:MM on a 24-hour clock", async () => {
    const repo = await repoWithEntities();
    for (const time of ["1:30", "25:00", "13:60", "13.30", ""]) {
      expect(await saveVesselHoldAdmin(repo, { ...base, time })).toEqual({
        ok: false,
        code: "bad_time",
      });
    }
    expect(await repo.listBlocks()).toHaveLength(0);
  });

  // The confirm step can sit open for minutes. Re-submitting it must not write a second row
  // for a slot that is already dark — the operator would see one blackout and the registry two.
  it("refuses a second hold on a slot already held, keeping the first row", async () => {
    const repo = await repoWithEntities();
    await saveVesselHoldAdmin(repo, base);
    const r = await saveVesselHoldAdmin(repo, { ...base, id: "hold-2" });
    expect(r).toEqual({ ok: false, code: "already_held" });
    const blocks = await repo.listBlocks();
    expect(blocks).toHaveLength(1);
    expect(String(blocks[0]!.id)).toBe("hold-1");
  });

  // Same staleness, worse outcome: someone books the slot while the confirm is open. DEC-125
  // says committed state beats blocks, so the hold loses rather than darkening a sold trip.
  it("refuses a slot a scheduled event already occupies", async () => {
    const repo = await repoWithEntities();
    await repo.saveEvent(scheduledEvent());
    const r = await saveVesselHoldAdmin(repo, base);
    expect(r).toEqual({ ok: false, code: "slot_taken" });
    expect(await repo.listBlocks()).toHaveLength(0);
  });

  // A cancelled event is not an occupancy — the boat is free and the slot is sellable again.
  it("allows a hold where the only event on the slot is cancelled", async () => {
    const repo = await repoWithEntities();
    await repo.saveEvent(scheduledEvent({ status: "cancelled" }));
    expect(await saveVesselHoldAdmin(repo, base)).toEqual({ ok: true, id: "hold-1" });
  });

  // The occupancy check is per-slot, not per-boat or per-day: the neighbouring departures and
  // the same time on another day must stay holdable while one slot is sold.
  it("holds a different time on the same boat-day, and the same time on another day", async () => {
    const repo = await repoWithEntities();
    await repo.saveEvent(scheduledEvent());
    expect(await saveVesselHoldAdmin(repo, { ...base, id: "h-a", time: "15:30" })).toEqual({
      ok: true,
      id: "h-a",
    });
    expect(await saveVesselHoldAdmin(repo, { ...base, id: "h-b", date: "2026-08-13" })).toEqual({
      ok: true,
      id: "h-b",
    });
  });
});

describe("releaseVesselHoldAdmin — lifting from the calendar", () => {
  it("releases a hold by id", async () => {
    const repo = await repoWithEntities();
    await saveVesselHoldAdmin(repo, {
      id: "hold-1",
      vesselId: "vessel-1",
      date: "2026-08-12",
      time: "13:30",
    });
    expect(await releaseVesselHoldAdmin(repo, "hold-1")).toEqual({ ok: true });
    expect(await repo.listBlocks()).toHaveLength(0);
  });

  it("reports not_found for an id that's already gone", async () => {
    const repo = await repoWithEntities();
    expect(await releaseVesselHoldAdmin(repo, "hold-missing")).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  // The kind check is the point of a separate door. The calendar never renders a location or
  // vessel block as releasable, so a request naming one is a hand-typed id — and deleting a
  // whole out-of-service range from a surface that never showed it is the damage to refuse.
  it("refuses to delete a block that isn't a hold", async () => {
    const repo = await repoWithEntities();
    await saveBlockAdmin(repo, {
      id: "blk-ves",
      kind: "vessel",
      vesselId: "vessel-1",
      startDate: "2026-08-11",
      endDate: "2026-08-14",
    });
    expect(await releaseVesselHoldAdmin(repo, "blk-ves")).toEqual({
      ok: false,
      code: "not_a_hold",
    });
    expect(await repo.listBlocks()).toHaveLength(1);
  });
});
