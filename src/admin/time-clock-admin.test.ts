/**
 * `/admin/time-clock` view models (#627) — the two views and the strip.
 *
 * (a) one crew × one pay period, (b) all crew × one day, plus the stale-open strip
 * that sits above both. The strip is the load-bearing one: a punch left open three
 * days ago appears in NEITHER view unless the operator happens to pick that crew or
 * that day, so without it the §2.9.5 forgotten clock-out is findable only by luck.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, TimePunch } from "../domain/entities.js";
import {
  buildCrewPeriodView,
  buildDayView,
  staleOpenPunches,
} from "./time-clock-admin.js";

const CAP = asId<"RoleTypeId">("role-captain");
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

const punch = (over: Omit<Partial<TimePunch>, "id"> & { id: string }): TimePunch => ({
  crewMemberId: QUINT,
  inAt: "2026-07-15T13:00:00.000Z",
  outAt: "2026-07-15T21:00:00.000Z",
  shiftId: null,
  origin: "crew",
  adminEditedAt: null,
  ...over,
  id: asId<"TimePunchId">(over.id),
});

async function seed(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveCrewMember(crew("crew-quint", "Quint"));
  await repo.saveCrewMember(crew("crew-hooper", "Hooper"));
  return repo;
}

const PERIOD = { start: "2026-07-06", end: "2026-07-19" };

describe("buildCrewPeriodView — one crew × one pay period", () => {
  it("carries the crew name, the period, and only that person's punches", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-mine" }));
    await repo.saveTimePunch(punch({ id: "p-theirs", crewMemberId: HOOPER }));

    const view = await buildCrewPeriodView(repo, QUINT, PERIOD);

    expect(view.crewName).toBe("Quint");
    expect(view.period).toEqual(PERIOD);
    expect(view.rows.map((r) => String(r.id))).toEqual(["p-mine"]);
  });

  it("excludes punches outside the period, bucketing on the vessel-local day", async () => {
    const repo = await seed();
    // 2026-07-20T00:00:00Z is 8pm EDT on the 19th — the period's LAST day.
    await repo.saveTimePunch(
      punch({ id: "p-edge", inAt: "2026-07-20T00:00:00.000Z", outAt: "2026-07-20T02:00:00.000Z" }),
    );
    await repo.saveTimePunch(
      punch({ id: "p-after", inAt: "2026-07-21T13:00:00.000Z", outAt: "2026-07-21T17:00:00.000Z" }),
    );

    const view = await buildCrewPeriodView(repo, QUINT, PERIOD);
    expect(view.rows.map((r) => String(r.id))).toEqual(["p-edge"]);
  });

  it("puts OPEN punches first, then newest-first — the repair bench's whole point", async () => {
    const repo = await seed();
    await repo.saveTimePunch(
      punch({ id: "p-newest", inAt: "2026-07-18T13:00:00.000Z", outAt: "2026-07-18T17:00:00.000Z" }),
    );
    await repo.saveTimePunch(
      punch({ id: "p-older", inAt: "2026-07-10T13:00:00.000Z", outAt: "2026-07-10T17:00:00.000Z" }),
    );
    // Open, and the OLDEST — must still sort to the top.
    await repo.saveTimePunch(punch({ id: "p-open", inAt: "2026-07-07T13:00:00.000Z", outAt: null }));

    const view = await buildCrewPeriodView(repo, QUINT, PERIOD);
    expect(view.rows.map((r) => String(r.id))).toEqual(["p-open", "p-newest", "p-older"]);
  });

  it("totals closed punches only and counts the open ones (§2.9.6)", async () => {
    const repo = await seed();
    await repo.saveTimePunch(
      punch({ id: "p1", inAt: "2026-07-10T13:00:00.000Z", outAt: "2026-07-10T17:00:00.000Z" }), // 240
    );
    await repo.saveTimePunch(punch({ id: "p-open", outAt: null }));

    const view = await buildCrewPeriodView(repo, QUINT, PERIOD);
    expect(view.totalMinutes).toBe(240);
    expect(view.openCount).toBe(1);
  });

  it("marks provenance so admin-entered hours never look like tapped ones (§2.9.8)", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-admin", origin: "admin" }));
    await repo.saveTimePunch(
      punch({
        id: "p-edited",
        inAt: "2026-07-14T13:00:00.000Z",
        outAt: "2026-07-14T17:00:00.000Z",
        adminEditedAt: "2026-07-14T20:00:00.000Z",
      }),
    );

    const view = await buildCrewPeriodView(repo, QUINT, PERIOD);
    const by = Object.fromEntries(view.rows.map((r) => [String(r.id), r]));
    expect(by["p-admin"]).toMatchObject({ enteredByAdmin: true, editedByAdmin: false });
    expect(by["p-edited"]).toMatchObject({ enteredByAdmin: false, editedByAdmin: true });
  });

  it("flags a punch that ends on a later vessel-local day — the overnight trip", async () => {
    const repo = await seed();
    // 10:00 PM EDT on the 15th → 2:00 AM EDT on the 16th. One punch, on the 15th.
    await repo.saveTimePunch(
      punch({ id: "p-night", inAt: "2026-07-16T02:00:00.000Z", outAt: "2026-07-16T06:00:00.000Z" }),
    );
    await repo.saveTimePunch(
      punch({ id: "p-day", inAt: "2026-07-15T13:00:00.000Z", outAt: "2026-07-15T21:00:00.000Z" }),
    );

    const view = await buildCrewPeriodView(repo, QUINT, PERIOD);
    const by = Object.fromEntries(view.rows.map((r) => [String(r.id), r]));
    expect(by["p-night"]).toMatchObject({ day: "2026-07-15", outIsNextDay: true, minutes: 240 });
    expect(by["p-day"]).toMatchObject({ outIsNextDay: false });
  });

  it("an unknown crew id yields an empty view rather than throwing", async () => {
    const repo = await seed();
    const view = await buildCrewPeriodView(repo, asId<"CrewMemberId">("ghost"), PERIOD);
    expect(view).toMatchObject({ crewName: null, rows: [], totalMinutes: 0 });
  });
});

describe("buildDayView — all crew × one day", () => {
  it("lists everyone's punches for that vessel-local day, with names", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-quint" }));
    await repo.saveTimePunch(punch({ id: "p-hooper", crewMemberId: HOOPER }));

    const view = await buildDayView(repo, "2026-07-15");

    expect(view.day).toBe("2026-07-15");
    expect(view.rows.map((r) => r.crewName).sort()).toEqual(["Hooper", "Quint"]);
  });

  it("uses the VESSEL-LOCAL day, so an 8pm punch belongs to the day it started", async () => {
    const repo = await seed();
    // 8:00 PM EDT on the 15th — already the 16th in UTC.
    await repo.saveTimePunch(
      punch({ id: "p-evening", inAt: "2026-07-16T00:00:00.000Z", outAt: "2026-07-16T02:00:00.000Z" }),
    );

    expect((await buildDayView(repo, "2026-07-15")).rows.map((r) => String(r.id))).toEqual([
      "p-evening",
    ]);
    expect((await buildDayView(repo, "2026-07-16")).rows).toEqual([]);
  });

  it("puts open punches first, then orders by crew name", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-quint" })); // Quint, closed
    await repo.saveTimePunch(punch({ id: "p-hooper", crewMemberId: HOOPER, outAt: null })); // open

    const view = await buildDayView(repo, "2026-07-15");
    expect(view.rows.map((r) => String(r.id))).toEqual(["p-hooper", "p-quint"]);
  });

  it("an empty day is empty, not an error", async () => {
    const repo = await seed();
    expect((await buildDayView(repo, "2026-07-15")).rows).toEqual([]);
  });
});

describe("staleOpenPunches — the strip above both views", () => {
  const TODAY = "2026-07-16";

  it("finds an open punch from an earlier day, with the crew name and its day", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-stale", inAt: "2026-07-14T13:00:00.000Z", outAt: null }));

    const stale = await staleOpenPunches(repo, TODAY);

    expect(stale).toEqual([
      expect.objectContaining({
        id: asId<"TimePunchId">("p-stale"),
        crewName: "Quint",
        day: "2026-07-14",
      }),
    ]);
  });

  it("ignores a punch open since TODAY — that's just someone on the clock", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-today", inAt: "2026-07-16T13:00:00.000Z", outAt: null }));

    expect(await staleOpenPunches(repo, TODAY)).toEqual([]);
  });

  it("ignores closed punches however old", async () => {
    const repo = await seed();
    await repo.saveTimePunch(
      punch({ id: "p-old", inAt: "2026-01-02T13:00:00.000Z", outAt: "2026-01-02T17:00:00.000Z" }),
    );

    expect(await staleOpenPunches(repo, TODAY)).toEqual([]);
  });

  it("spans crew and periods — the whole point is that it doesn't depend on the picker", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p-a", inAt: "2026-07-14T13:00:00.000Z", outAt: null }));
    await repo.saveTimePunch(
      punch({ id: "p-b", crewMemberId: HOOPER, inAt: "2026-03-02T13:00:00.000Z", outAt: null }),
    );

    const stale = await staleOpenPunches(repo, TODAY);
    // Oldest first — the most overdue repair leads.
    expect(stale.map((s) => String(s.id))).toEqual(["p-b", "p-a"]);
  });
});
