import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { buildCalendarFeed, renderCalendar } from "./calendar-feed.js";

const TENANT = asId<"TenantId">("t");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-orca");
const ME = asId<"CrewMemberId">("crew-quint");
const TZ = "America/New_York";
// A fixed "now" so retention/horizon are deterministic.
const NOW = new Date("2026-07-10T12:00:00.000Z");

let repo: InMemoryRepository;
beforeEach(async () => {
  repo = new InMemoryRepository();
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
  await repo.saveRoleType({ id: MATE, tenantId: TENANT, name: "mate" });
  await repo.saveVessel({ id: VESSEL, name: "Orca", coiMaxPax: 12, manning: [] });
  await repo.saveCrewMember({
    id: ME,
    name: "Quint Brody",
    phone: "555",
    ratings: [],
    status: "active",
    reliabilityScore: null,
  });
});

/** Seed one shift on `date` with a single scheduled departure at `time`, and a
 *  Confirmed captain seat held by `crew` (default ME). Returns the shift id. */
async function seedShift(
  id: string,
  date: string,
  time: string,
  opts: {
    crew?: ReturnType<typeof asId<"CrewMemberId">>;
    kind?: "required" | "supernumerary";
    dock?: string;
    role?: ReturnType<typeof asId<"RoleTypeId">>;
    state?: "Confirmed" | "Claimed";
    shiftState?: "Filling" | "Crewed" | "Cancelled" | "Completed";
  } = {},
): Promise<string> {
  const eventId = asId<"EventId">(`evt-${id}`);
  await repo.saveEvent({
    id: eventId,
    vesselId: VESSEL,
    date,
    time,
    capacity: 12,
    status: "scheduled",
    ...(opts.dock ? { dock: opts.dock } : {}),
  });
  await repo.saveShift({
    id: asId<"ShiftId">(id),
    vesselId: VESSEL,
    date,
    state: opts.shiftState ?? "Crewed",
    eventIds: [eventId],
  });
  await repo.saveSeat({
    id: asId<"SeatId">(`seat-${id}`),
    shiftId: asId<"ShiftId">(id),
    role: opts.role ?? CAPTAIN,
    kind: opts.kind ?? "required",
    state: opts.state ?? "Confirmed",
    assignedCrewMemberId: opts.crew ?? ME,
  });
  return id;
}

describe("buildCalendarFeed (#355)", () => {
  it("returns the crew member's confirmed shifts as call→end instants", async () => {
    // 6:00 PM ET departure on 2026-07-15. Call = 6:00 PM − 45m = 5:15 PM;
    // end = 6:00 PM + 100m trip + 25m teardown = 8:05 PM ET (#275).
    await seedShift("s1", "2026-07-15", "18:00", { dock: "Canal Basin" });

    const feed = await buildCalendarFeed(repo, ME, NOW, TZ);
    expect(feed).not.toBeNull();
    expect(feed!.crewName).toBe("Quint Brody");
    expect(feed!.events).toHaveLength(1);
    const ev = feed!.events[0]!;
    // 5:15 PM ET = 21:15 UTC (EDT, −4).
    expect(ev.start.toISOString()).toBe("2026-07-15T21:15:00.000Z");
    // 8:05 PM ET = 00:05 UTC next day.
    expect(ev.end.toISOString()).toBe("2026-07-16T00:05:00.000Z");
    expect(ev.uid).toBe("s1");
    expect(ev.vesselName).toBe("Orca");
    expect(ev.roleName).toBe("captain");
    expect(ev.dock).toBe("Canal Basin");
    expect(ev.training).toBe(false);
  });

  it("includes confirmed supernumerary rides, flagged as training", async () => {
    await seedShift("train", "2026-07-15", "18:00", { kind: "supernumerary" });
    const feed = await buildCalendarFeed(repo, ME, NOW, TZ);
    expect(feed!.events[0]!.training).toBe(true);
  });

  it("excludes claimed (tentative), cancelled, completed, and past-retention shifts", async () => {
    await seedShift("confirmed", "2026-07-15", "18:00");
    await seedShift("tentative", "2026-07-16", "18:00", { state: "Claimed" });
    await seedShift("killed", "2026-07-17", "18:00", { shiftState: "Cancelled" });
    await seedShift("done", "2026-07-18", "18:00", { shiftState: "Completed" });
    // 2026-07-01 is 9 days before NOW (2026-07-10) → past the 7-day retention floor.
    await seedShift("old", "2026-07-01", "18:00");

    const feed = await buildCalendarFeed(repo, ME, NOW, TZ);
    expect(feed!.events.map((e) => e.uid)).toEqual(["confirmed"]);
  });

  it("keeps a just-finished shift within the 7-day retention window", async () => {
    // 2026-07-05 is 5 days before NOW → still inside retention.
    await seedShift("recent", "2026-07-05", "18:00");
    const feed = await buildCalendarFeed(repo, ME, NOW, TZ);
    expect(feed!.events.map((e) => e.uid)).toEqual(["recent"]);
  });

  it("carries co-crew FIRST names only, deduped and sorted — never phones", async () => {
    const HOOPER = asId<"CrewMemberId">("crew-hooper");
    await repo.saveCrewMember({
      id: HOOPER,
      name: "Matt Hooper",
      phone: "555-999",
      ratings: [],
      status: "active",
      reliabilityScore: null,
    });
    await seedShift("shared", "2026-07-15", "18:00");
    // Hooper on the same shift, confirmed mate seat.
    await repo.saveSeat({
      id: asId<"SeatId">("seat-shared-2"),
      shiftId: asId<"ShiftId">("shared"),
      role: MATE,
      kind: "required",
      state: "Confirmed",
      assignedCrewMemberId: HOOPER,
    });

    const feed = await buildCalendarFeed(repo, ME, NOW, TZ);
    const ev = feed!.events[0]!;
    expect(ev.coCrewFirstNames).toEqual(["Matt"]); // first name only, not "Matt Hooper"
    const ics = renderCalendar(feed!, {
      calendarName: "BrewBoat — Quint",
      appBaseUrl: "https://muster.example",
      now: NOW,
    });
    expect(ics).not.toContain("555-999"); // no phone ever reaches the .ics
    expect(ics).not.toContain("Hooper"); // last name stays in-app
  });

  it("returns null for an unknown crew member (revoked/rotated token)", async () => {
    expect(
      await buildCalendarFeed(repo, asId<"CrewMemberId">("ghost"), NOW, TZ),
    ).toBeNull();
  });
});

describe("renderCalendar (#355) — RFC-5545", () => {
  it("emits a well-formed VCALENDAR with UTC instants and a stable UID", async () => {
    await seedShift("s1", "2026-07-15", "18:00", { dock: "Canal Basin" });
    const feed = await buildCalendarFeed(repo, ME, NOW, TZ);
    const ics = renderCalendar(feed!, {
      calendarName: "BrewBoat — Quint",
      appBaseUrl: "https://muster.example",
      now: NOW,
    });

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("\r\n"); // CRLF line endings
    expect(ics).toContain("UID:s1@muster");
    expect(ics).toContain("DTSTART:20260715T211500Z");
    expect(ics).toContain("DTEND:20260716T000500Z");
    expect(ics).toContain("SUMMARY:Orca — captain");
    expect(ics).toContain("LOCATION:Canal Basin");
    expect(ics).toContain("Manifest & contacts in Muster: https://muster.example/crew");
  });

  it("escapes RFC-5545 TEXT special chars in SUMMARY", async () => {
    await repo.saveVessel({ id: VESSEL, name: "Orca; the, boat", coiMaxPax: 12, manning: [] });
    await seedShift("s1", "2026-07-15", "18:00");
    const feed = await buildCalendarFeed(repo, ME, NOW, TZ);
    const ics = renderCalendar(feed!, {
      calendarName: "cal",
      appBaseUrl: "https://x",
      now: NOW,
    });
    // `;` and `,` are backslash-escaped in the value.
    expect(ics).toContain("SUMMARY:Orca\\; the\\, boat — captain");
  });

  it("folds lines longer than 75 octets with a leading-space continuation", async () => {
    const longName = "A".repeat(120);
    await repo.saveVessel({ id: VESSEL, name: longName, coiMaxPax: 12, manning: [] });
    await seedShift("s1", "2026-07-15", "18:00");
    const feed = await buildCalendarFeed(repo, ME, NOW, TZ);
    const ics = renderCalendar(feed!, { calendarName: "c", appBaseUrl: "https://x", now: NOW });
    // Every physical line is ≤ 75 octets; a continuation starts with a single space.
    const physical = ics.split("\r\n");
    for (const line of physical) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(physical.some((l) => l.startsWith(" "))).toBe(true);
  });
});
