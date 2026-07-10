/**
 * Time-off use-cases (#332) — the write door over `PtoWindow`. Covers date
 * validation (the dates-as-text guard), the `start ≤ end` order, ownership
 * gating for the crew remove path, and the admin per-crew grouping/sort.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember } from "../domain/entities.js";
import {
  addTimeOff,
  buildAllTimeOff,
  ownsTimeOff,
  removeTimeOff,
} from "./time-off.js";

const CREW = asId<"CrewMemberId">("crew-1");
const OTHER = asId<"CrewMemberId">("crew-2");

const crewMember = (id: string, name: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name,
  phone: "+15035559000",
  ratings: [],
  status: "active",
  reliabilityScore: null,
});

const win = (id: string, crew = CREW, start = "2026-07-11", end = "2026-07-11") => ({
  id: asId<"PtoWindowId">(id),
  crewMemberId: crew,
  start,
  end,
});

describe("addTimeOff", () => {
  it("saves a valid single-day window", async () => {
    const repo = new InMemoryRepository();
    const r = await addTimeOff(repo, win("pto-1"));
    expect(r.ok).toBe(true);
    expect(await repo.listPtoWindowsForCrew(CREW)).toEqual([
      { id: "pto-1", crewMemberId: CREW, start: "2026-07-11", end: "2026-07-11" },
    ]);
  });

  it("saves a valid multi-day span", async () => {
    const repo = new InMemoryRepository();
    const r = await addTimeOff(repo, win("pto-1", CREW, "2026-07-11", "2026-07-20"));
    expect(r.ok).toBe(true);
  });

  it("rejects a malformed date without persisting", async () => {
    const repo = new InMemoryRepository();
    const r = await addTimeOff(repo, win("pto-1", CREW, "2026-13-99", "2026-07-11"));
    expect(r).toEqual({ ok: false, code: "bad_date" });
    expect(await repo.listAllPtoWindows()).toEqual([]);
  });

  it("rejects an inverted range (end before start)", async () => {
    const repo = new InMemoryRepository();
    const r = await addTimeOff(repo, win("pto-1", CREW, "2026-07-20", "2026-07-11"));
    expect(r).toEqual({ ok: false, code: "end_before_start" });
    expect(await repo.listAllPtoWindows()).toEqual([]);
  });

  it("allows a past-dated window (record correction is fine)", async () => {
    const repo = new InMemoryRepository();
    const r = await addTimeOff(repo, win("pto-1", CREW, "2020-01-01", "2020-01-02"));
    expect(r.ok).toBe(true);
  });
});

describe("removeTimeOff + ownsTimeOff", () => {
  it("removes a window", async () => {
    const repo = new InMemoryRepository();
    await addTimeOff(repo, win("pto-1"));
    await removeTimeOff(repo, asId<"PtoWindowId">("pto-1"));
    expect(await repo.listPtoWindowsForCrew(CREW)).toEqual([]);
  });

  it("ownsTimeOff is true for the owner, false for a stranger's id", async () => {
    const repo = new InMemoryRepository();
    await addTimeOff(repo, win("pto-mine", CREW));
    await addTimeOff(repo, win("pto-theirs", OTHER));
    expect(await ownsTimeOff(repo, CREW, asId<"PtoWindowId">("pto-mine"))).toBe(true);
    expect(await ownsTimeOff(repo, CREW, asId<"PtoWindowId">("pto-theirs"))).toBe(false);
    expect(await ownsTimeOff(repo, CREW, asId<"PtoWindowId">("nope"))).toBe(false);
  });
});

describe("buildAllTimeOff", () => {
  it("groups by crew, sorts crews by name and windows by start", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crewMember("crew-1", "Zed"));
    await repo.saveCrewMember(crewMember("crew-2", "Ann"));
    await addTimeOff(repo, win("pto-z2", CREW, "2026-08-01", "2026-08-02"));
    await addTimeOff(repo, win("pto-z1", CREW, "2026-07-01", "2026-07-02"));
    await addTimeOff(repo, win("pto-a1", OTHER, "2026-07-15", "2026-07-15"));

    const view = await buildAllTimeOff(repo);
    expect(view.map((g) => g.crewName)).toEqual(["Ann", "Zed"]); // name sort
    const zed = view.find((g) => g.crewName === "Zed")!;
    expect(zed.windows.map((w) => w.start)).toEqual(["2026-07-01", "2026-08-01"]); // start sort
  });

  it("skips an orphaned window (crew id with no member — no-FK bet)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crewMember("crew-1", "Ann"));
    await addTimeOff(repo, win("pto-1", CREW));
    await addTimeOff(repo, win("pto-orphan", asId<"CrewMemberId">("ghost")));
    const view = await buildAllTimeOff(repo);
    expect(view.map((g) => g.crewName)).toEqual(["Ann"]);
  });
});
