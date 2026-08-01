/**
 * `/crew/time` view model (#626, SPEC §2.9.7) — the crew member's own clock.
 *
 * The page renders this and decides nothing, so everything worth asserting lives
 * here: which button to show, the "on the clock since" label, this pay period's
 * punches, and the total. The total is the load-bearing one — §2.9.6 says open
 * punches are excluded from hours and counted separately, because a number you can
 * see is incomplete beats a number that is silently short.
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, TimePunch } from "../domain/entities.js";
import { buildCrewTimeView } from "./time-view.js";

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

// `Omit<…, "id">` matters: intersecting with `Partial<TimePunch>` would make `id`
// `string & TimePunchId` and force every call site to brand its own literal.
const punch = (over: Omit<Partial<TimePunch>, "id"> & { id: string }): TimePunch => ({
  crewMemberId: QUINT,
  inAt: "2026-07-15T13:00:00.000Z",
  outAt: null,
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

// The anchor is 2026-01-05; 14-day periods run …/2026-07-06→2026-07-19/…
// 2026-07-15 sits mid-period. EDT (UTC-4): 13:00Z = 9:00 AM local.
const NOW = new Date("2026-07-15T17:00:00.000Z"); // 1:00 PM EDT

describe("buildCrewTimeView — which button", () => {
  it("nothing open → onTheClock is null (the surface shows Clock in)", async () => {
    const repo = await seed();
    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view.onTheClock).toBeNull();
  });

  it("an open punch → onTheClock carries a vessel-local since-label", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1" })); // 13:00Z = 9:00 AM EDT
    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view.onTheClock).toMatchObject({
      punchId: asId<"TimePunchId">("p1"),
      sinceTime: "09:00",
      sinceDate: "2026-07-15",
      startedOnAnEarlierDay: false,
    });
  });

  it("someone else's open punch is not mine", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1", crewMemberId: HOOPER }));
    expect((await buildCrewTimeView(repo, QUINT, NOW)).onTheClock).toBeNull();
  });

  it("flags a punch left open from an earlier day — the forgotten clock-out (§2.9.5)", async () => {
    const repo = await seed();
    await repo.saveTimePunch(punch({ id: "p1", inAt: "2026-07-14T13:00:00.000Z" }));
    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view.onTheClock).toMatchObject({
      sinceDate: "2026-07-14",
      startedOnAnEarlierDay: true,
    });
  });
});

describe("buildCrewTimeView — this pay period", () => {
  it("reports the period containing today, vessel-local", async () => {
    const repo = await seed();
    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view.period).toEqual({ start: "2026-07-06", end: "2026-07-19" });
  });

  it("lists my punches newest-first with vessel-local times and minutes", async () => {
    const repo = await seed();
    await repo.saveTimePunch(
      punch({ id: "p-mon", inAt: "2026-07-13T13:00:00.000Z", outAt: "2026-07-13T21:30:00.000Z" }),
    );
    await repo.saveTimePunch(
      punch({ id: "p-wed", inAt: "2026-07-15T12:00:00.000Z", outAt: "2026-07-15T16:00:00.000Z" }),
    );

    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view.punches).toEqual([
      {
        id: asId<"TimePunchId">("p-wed"),
        date: "2026-07-15",
        inTime: "08:00",
        outTime: "12:00",
        minutes: 240,
        open: false,
        adminTouched: false,
      },
      {
        id: asId<"TimePunchId">("p-mon"),
        date: "2026-07-13",
        inTime: "09:00",
        outTime: "17:30",
        minutes: 510,
        open: false,
        adminTouched: false,
      },
    ]);
  });

  it("excludes punches outside the period, and other people's", async () => {
    const repo = await seed();
    await repo.saveTimePunch(
      punch({ id: "p-last-period", inAt: "2026-07-05T13:00:00.000Z", outAt: "2026-07-05T17:00:00.000Z" }),
    );
    await repo.saveTimePunch(
      punch({ id: "p-next-period", inAt: "2026-07-27T13:00:00.000Z", outAt: "2026-07-27T17:00:00.000Z" }),
    );
    await repo.saveTimePunch(
      punch({ id: "p-theirs", crewMemberId: HOOPER, inAt: "2026-07-15T13:00:00.000Z", outAt: "2026-07-15T17:00:00.000Z" }),
    );

    expect((await buildCrewTimeView(repo, QUINT, NOW)).punches).toEqual([]);
  });

  it("buckets by the VESSEL-LOCAL date of inAt — an 8pm punch on the last day is in THIS period", async () => {
    // 2026-07-20T00:00:00Z is 8pm EDT on 2026-07-19, the period's last day.
    // Bucketing on the UTC date would push it into the next paycheck.
    const repo = await seed();
    await repo.saveTimePunch(
      punch({ id: "p-edge", inAt: "2026-07-20T00:00:00.000Z", outAt: "2026-07-20T02:00:00.000Z" }),
    );

    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view.punches.map((p) => String(p.id))).toEqual(["p-edge"]);
    expect(view.punches[0]!.date).toBe("2026-07-19");
  });

  it("marks a punch an admin entered or edited (§2.9.8)", async () => {
    const repo = await seed();
    await repo.saveTimePunch(
      punch({
        id: "p-admin",
        inAt: "2026-07-15T12:00:00.000Z",
        outAt: "2026-07-15T16:00:00.000Z",
        origin: "admin",
      }),
    );
    await repo.saveTimePunch(
      punch({
        id: "p-edited",
        inAt: "2026-07-14T12:00:00.000Z",
        outAt: "2026-07-14T16:00:00.000Z",
        adminEditedAt: "2026-07-14T20:00:00.000Z",
      }),
    );

    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view.punches.map((p) => p.adminTouched)).toEqual([true, true]);
  });
});

describe("buildCrewTimeView — the total", () => {
  it("sums closed punches in the period", async () => {
    const repo = await seed();
    await repo.saveTimePunch(
      punch({ id: "p1", inAt: "2026-07-13T13:00:00.000Z", outAt: "2026-07-13T21:30:00.000Z" }), // 510
    );
    await repo.saveTimePunch(
      punch({ id: "p2", inAt: "2026-07-14T13:00:00.000Z", outAt: "2026-07-14T17:00:00.000Z" }), // 240
    );

    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view.totalMinutes).toBe(750);
    expect(view.openCount).toBe(0);
  });

  it("EXCLUDES the open punch from the total and counts it separately (§2.9.6)", async () => {
    const repo = await seed();
    await repo.saveTimePunch(
      punch({ id: "p-closed", inAt: "2026-07-13T13:00:00.000Z", outAt: "2026-07-13T17:00:00.000Z" }), // 240
    );
    await repo.saveTimePunch(punch({ id: "p-open", inAt: "2026-07-15T13:00:00.000Z" }));

    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view.totalMinutes).toBe(240); // NOT 240 + however long p-open has been running
    expect(view.openCount).toBe(1);
    expect(view.punches.find((p) => String(p.id) === "p-open")).toMatchObject({
      open: true,
      outTime: null,
      minutes: null,
    });
  });

  it("a punch spanning the fall-back transition counts TRUE elapsed minutes", async () => {
    // 2026-11-01: 01:00 EDT (05:00Z) → 03:00 EST (08:00Z) is 3 real hours, though
    // the wall clock advanced 2. Instants make this right; wall-clock math wouldn't.
    const repo = await seed();
    await repo.saveTimePunch(
      punch({ id: "p-dst", inAt: "2026-11-01T05:00:00.000Z", outAt: "2026-11-01T08:00:00.000Z" }),
    );

    const view = await buildCrewTimeView(repo, QUINT, new Date("2026-11-01T18:00:00.000Z"));
    expect(view.totalMinutes).toBe(180);
  });

  it("does NOT round — a punch stamped mid-minute keeps its fraction (§2.9.6)", async () => {
    // Both ends are stamped at button-press, so a real punch essentially never lands
    // on a whole minute. §2.9.6 forbids a rounding policy "in neither direction", and
    // rounding here would put a silent ±30s into the value the spec calls exact.
    // 09:00:20 → 17:00:50 is 480.5 minutes, not 480 and not 481.
    const repo = await seed();
    await repo.saveTimePunch(
      punch({ id: "p-odd", inAt: "2026-07-15T13:00:20.000Z", outAt: "2026-07-15T21:00:50.000Z" }),
    );

    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view.punches[0]!.minutes).toBe(480.5);
    expect(view.totalMinutes).toBe(480.5);
  });

  it("an empty period is zero, not an error", async () => {
    const repo = await seed();
    const view = await buildCrewTimeView(repo, QUINT, NOW);
    expect(view).toMatchObject({ punches: [], totalMinutes: 0, openCount: 0 });
  });
});
