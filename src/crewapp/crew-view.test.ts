import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type {
  Ask,
  CrewMember,
  RoleType,
  Seat,
  Shift,
  Vessel,
} from "../domain/entities.js";
import { buildCrewAppView } from "./crew-view.js";
import { logShiftBailed, logShiftCompleted } from "../oracle/reliability-log.js";

const NOW = new Date("2026-07-01T12:00:00.000Z");
const TENANT = asId<"TenantId">("t");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const VESSEL = asId<"VesselId">("vessel-1");
const ME = asId<"CrewMemberId">("crew-me");

async function seed(over: { score?: number | null } = {}): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  const role: RoleType = { id: CAPTAIN, tenantId: TENANT, name: "captain" };
  const vessel: Vessel = { id: VESSEL, name: "Hops", coiMaxPax: 12, manning: [{ roleTypeId: CAPTAIN, count: 2 }] };
  const me: CrewMember = {
    id: ME,
    name: "Quint",
    phone: "555",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: over.score === undefined ? null : over.score,
  };
  await repo.saveRoleType(role);
  await repo.saveVessel(vessel);
  await repo.saveCrewMember(me);

  // Upcoming confirmed shift (should appear in my-shifts).
  const upcoming: Shift = { id: asId<"ShiftId">("shift-up"), vesselId: VESSEL, date: "2026-07-04", state: "Crewed", eventIds: [] };
  const upSeat: Seat = { id: asId<"SeatId">("seat-up"), shiftId: upcoming.id, role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: ME };
  // Past confirmed shift (should drop off).
  const past: Shift = { id: asId<"ShiftId">("shift-past"), vesselId: VESSEL, date: "2026-06-20", state: "Completed", eventIds: [] };
  const pastSeat: Seat = { id: asId<"SeatId">("seat-past"), shiftId: past.id, role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: ME };
  // A shift with an OPEN ask to me (seat Asked, ask unanswered).
  const asked: Shift = { id: asId<"ShiftId">("shift-ask"), vesselId: VESSEL, date: "2026-07-05", state: "Filling", eventIds: [] };
  const askedSeat: Seat = { id: asId<"SeatId">("seat-ask"), shiftId: asked.id, role: CAPTAIN, kind: "required", state: "Asked" };
  const openAsk: Ask = { id: asId<"AskId">("ask-open"), seatId: askedSeat.id, crewMemberId: ME, channel: "push", sentAt: "2026-07-01T09:00:00.000Z" };
  // An already-answered ask to me (should NOT appear).
  const answeredSeat: Seat = { id: asId<"SeatId">("seat-ans"), shiftId: asked.id, role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: ME };
  const answeredAsk: Ask = { id: asId<"AskId">("ask-ans"), seatId: answeredSeat.id, crewMemberId: ME, channel: "push", sentAt: "2026-06-30T09:00:00.000Z", respondedAt: "2026-06-30T09:01:00.000Z", response: "accepted" };

  for (const s of [upcoming, past, asked]) await repo.saveShift(s);
  for (const s of [upSeat, pastSeat, askedSeat, answeredSeat]) await repo.saveSeat(s);
  for (const a of [openAsk, answeredAsk]) await repo.saveAsk(a);
  return repo;
}

describe("buildCrewAppView", () => {
  it("returns null for an unknown crew member (stale session)", async () => {
    const repo = await seed();
    expect(await buildCrewAppView(repo, asId<"CrewMemberId">("ghost"), NOW)).toBeNull();
  });

  it("surfaces only the open, unanswered ask on a still-Asked seat", async () => {
    const view = await buildCrewAppView(await seed(), ME, NOW);
    expect(view!.asks).toHaveLength(1);
    expect(view!.asks[0]).toMatchObject({
      askId: "ask-open",
      seatId: "seat-ask",
      vesselName: "Hops",
      roleName: "captain",
      date: "2026-07-05",
    });
  });

  it("does NOT surface a timed-out ask (respondedAt set, no response) — the double-card bug", async () => {
    const repo = await seed();
    // A closed/timed-out ask to me on a still-Asked seat: respondedAt stamped,
    // response left undefined (what expireAsks / the outbox seed's close-prior do).
    await repo.saveShift({ id: asId<"ShiftId">("shift-to"), vesselId: VESSEL, date: "2026-07-06", state: "Filling", eventIds: [] });
    await repo.saveSeat({ id: asId<"SeatId">("seat-to"), shiftId: asId<"ShiftId">("shift-to"), role: CAPTAIN, kind: "required", state: "Asked" });
    await repo.saveAsk({ id: asId<"AskId">("ask-timedout"), seatId: asId<"SeatId">("seat-to"), crewMemberId: ME, channel: "push", sentAt: "2026-07-01T09:00:00.000Z", respondedAt: "2026-07-01T10:00:00.000Z" });

    const view = await buildCrewAppView(repo, ME, NOW);
    const ids = view!.asks.map((a) => a.askId);
    expect(ids).not.toContain("ask-timedout"); // closed → not answerable
    expect(ids).toContain("ask-open"); // the genuinely-open one still shows
  });

  it("flags an operator-placed shift (Confirmed, no accepted ask) as addedByOperator (#161)", async () => {
    const view = await buildCrewAppView(await seed(), ME, NOW);
    const up = view!.shifts.find((s) => s.shiftId === "shift-up")!; // seat-up: no ask → operator placed me
    const ans = view!.shifts.find((s) => s.shiftId === "shift-ask")!; // seat-ans: I accepted the ask
    expect(up.addedByOperator).toBe(true);
    expect(ans.addedByOperator).toBe(false);
  });

  it("addedByOperator edges: declined-then-placed flags; a Claimed (pending) seat never does (#161)", async () => {
    const repo = await seed();
    // Confirmed seat I DECLINED an ask for, then was placed onto → still operator-added.
    await repo.saveShift({ id: asId<"ShiftId">("shift-dec"), vesselId: VESSEL, date: "2026-07-08", state: "Crewed", eventIds: [] });
    await repo.saveSeat({ id: asId<"SeatId">("seat-dec"), shiftId: asId<"ShiftId">("shift-dec"), role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: ME });
    await repo.saveAsk({ id: asId<"AskId">("ask-dec"), seatId: asId<"SeatId">("seat-dec"), crewMemberId: ME, channel: "push", sentAt: "2026-07-01T08:00:00.000Z", respondedAt: "2026-07-01T08:05:00.000Z", response: "declined" });
    // Claimed (pending) seat — claim = "In", so never operator-added.
    await repo.saveShift({ id: asId<"ShiftId">("shift-cl"), vesselId: VESSEL, date: "2026-07-09", state: "Filling", eventIds: [] });
    await repo.saveSeat({ id: asId<"SeatId">("seat-cl"), shiftId: asId<"ShiftId">("shift-cl"), role: CAPTAIN, kind: "required", state: "Claimed", assignedCrewMemberId: ME });

    const view = await buildCrewAppView(repo, ME, NOW);
    const dec = view!.shifts.find((s) => s.shiftId === "shift-dec")!;
    const cl = view!.shifts.find((s) => s.shiftId === "shift-cl")!;
    expect(dec.addedByOperator).toBe(true); // declined ≠ accepted → operator placed me
    expect(cl.addedByOperator).toBe(false); // Claimed (pending) is never operator-added
    expect(cl.pending).toBe(true);
  });

  it("provenance decides addedByOperator: a self-claim is NOT flagged; an operator override is (#196)", async () => {
    const repo = await seed();
    // A SELF-claimed Confirmed seat (no accepted ask) — the #196 bug: the old
    // `!iAccepted` inference flagged it. Provenance `self_claim` must override → no badge.
    await repo.saveShift({ id: asId<"ShiftId">("shift-self"), vesselId: VESSEL, date: "2026-07-10", state: "Crewed", eventIds: [] });
    await repo.saveSeat({ id: asId<"SeatId">("seat-self"), shiftId: asId<"ShiftId">("shift-self"), role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: ME, acquiredVia: "self_claim" });
    // An operator-override Confirmed seat — provenance `operator` → badge.
    await repo.saveShift({ id: asId<"ShiftId">("shift-op"), vesselId: VESSEL, date: "2026-07-11", state: "Crewed", eventIds: [] });
    await repo.saveSeat({ id: asId<"SeatId">("seat-op"), shiftId: asId<"ShiftId">("shift-op"), role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: ME, acquiredVia: "operator" });

    const view = await buildCrewAppView(repo, ME, NOW);
    expect(view!.shifts.find((s) => s.shiftId === "shift-self")!.addedByOperator).toBe(false);
    expect(view!.shifts.find((s) => s.shiftId === "shift-op")!.addedByOperator).toBe(true);
  });

  it("ask card carries the earliest scheduled departure (so the crew knows when)", async () => {
    const repo = await seed();
    await repo.saveShift({ id: asId<"ShiftId">("shift-ev"), vesselId: VESSEL, date: "2026-07-07", state: "Filling", eventIds: [asId<"EventId">("e-5pm"), asId<"EventId">("e-3pm")] });
    await repo.saveEvent({ id: asId<"EventId">("e-3pm"), vesselId: VESSEL, date: "2026-07-07", time: "15:00", capacity: 12, status: "scheduled" });
    await repo.saveEvent({ id: asId<"EventId">("e-5pm"), vesselId: VESSEL, date: "2026-07-07", time: "17:00", capacity: 12, status: "scheduled" });
    await repo.saveSeat({ id: asId<"SeatId">("seat-ev"), shiftId: asId<"ShiftId">("shift-ev"), role: CAPTAIN, kind: "required", state: "Asked" });
    await repo.saveAsk({ id: asId<"AskId">("ask-ev"), seatId: asId<"SeatId">("seat-ev"), crewMemberId: ME, channel: "push", sentAt: "2026-07-01T09:30:00.000Z" });

    const view = await buildCrewAppView(repo, ME, NOW);
    const ask = view!.asks.find((a) => a.askId === "ask-ev");
    expect(ask?.departureTime).toBe("15:00"); // earliest of 15:00/17:00
    expect(ask?.shiftEndTime).toBe("19:05"); // latest 17:00 + 100 trip + 25 teardown (DEC-041, #275)
  });

  it("lists confirmed upcoming shifts soonest-first, drops past ones", async () => {
    const view = await buildCrewAppView(await seed(), ME, NOW);
    expect(view!.shifts.map((s) => s.shiftId)).toEqual(["shift-up", "shift-ask"]);
    expect(view!.shifts[0]).toMatchObject({ vesselName: "Hops", vesselId: "vessel-1", roleName: "captain", date: "2026-07-04", pending: false });
  });

  it("includes a Claimed (not-yet-confirmed) seat in my-shifts, marked pending (#4)", async () => {
    const repo = await seed();
    // A claimed-but-unconfirmed seat to me on a new, sooner upcoming shift.
    await repo.saveShift({ id: asId<"ShiftId">("shift-claim"), vesselId: VESSEL, date: "2026-07-03", state: "Filling", eventIds: [] });
    await repo.saveSeat({ id: asId<"SeatId">("seat-claim"), shiftId: asId<"ShiftId">("shift-claim"), role: CAPTAIN, kind: "required", state: "Claimed", assignedCrewMemberId: ME });

    const view = await buildCrewAppView(repo, ME, NOW);
    expect(view!.shifts.find((s) => s.shiftId === "shift-claim")).toMatchObject({ date: "2026-07-03", pending: true });
    expect(view!.shifts.find((s) => s.shiftId === "shift-up")!.pending).toBe(false);
  });

  it("My-shifts card carries the working window + co-crew (#216)", async () => {
    const repo = await seed();
    // A confirmed shift I'm on, with two trips and a co-crew captain (Jamie).
    const jamie = asId<"CrewMemberId">("crew-jamie");
    await repo.saveCrewMember({ id: jamie, name: "Jamie", phone: "555", ratings: [CAPTAIN], status: "active", reliabilityScore: null });
    await repo.saveShift({ id: asId<"ShiftId">("shift-w"), vesselId: VESSEL, date: "2026-07-02", state: "Crewed", eventIds: [asId<"EventId">("w-pm"), asId<"EventId">("w-am")] });
    await repo.saveEvent({ id: asId<"EventId">("w-am"), vesselId: VESSEL, date: "2026-07-02", time: "11:00", capacity: 12, status: "scheduled" });
    await repo.saveEvent({ id: asId<"EventId">("w-pm"), vesselId: VESSEL, date: "2026-07-02", time: "17:00", capacity: 12, status: "scheduled" });
    await repo.saveSeat({ id: asId<"SeatId">("seat-w-me"), shiftId: asId<"ShiftId">("shift-w"), role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: ME });
    await repo.saveSeat({ id: asId<"SeatId">("seat-w-jamie"), shiftId: asId<"ShiftId">("shift-w"), role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: jamie });

    const view = await buildCrewAppView(repo, ME, NOW);
    const row = view!.shifts.find((s) => s.shiftId === "shift-w")!;
    expect(row.departureTime).toBe("11:00"); // earliest of 11:00/17:00
    expect(row.shiftEndTime).toBe("19:05"); // latest 17:00 + 100 trip + 25 teardown (DEC-041, #275)
    expect(row.coCrew).toEqual([{ name: "Jamie", roleName: "captain" }]); // the OTHER crew, not me

    // A solo/no-events shift: empty co-crew, no window.
    const up = view!.shifts.find((s) => s.shiftId === "shift-up")!;
    expect(up.coCrew).toEqual([]);
    expect(up.departureTime).toBeUndefined();
  });

  it("standing reads neutral with no logged history", async () => {
    const view = await buildCrewAppView(await seed(), ME, NOW);
    expect(view!.standing).toEqual({
      hasHistory: false,
      line: "New — no track record yet",
      reasons: [],
    });
  });

  it("standing is derived live from the reliability log, not a stored field", async () => {
    const repo = await seed({ score: 7 }); // stored field is ignored now
    const shiftId = asId<"ShiftId">("shift-past");
    await logShiftCompleted(repo, ME, shiftId, NOW);
    await logShiftCompleted(repo, ME, shiftId, NOW);
    await logShiftBailed(repo, ME, shiftId, NOW, 0); // early bail

    const view = await buildCrewAppView(repo, ME, NOW);
    expect(view!.standing.hasHistory).toBe(true);
    expect(view!.standing.reasons).toContain("showed 2/3");
    expect(view!.standing.line).toContain("showed 2/3");
  });

  it("credentialNudge is null with healthy (or no) credentials — no line, no noise", async () => {
    const repo = await seed();
    expect((await buildCrewAppView(repo, ME, NOW))!.credentialNudge).toBeNull();

    await repo.saveCredential({
      id: asId<"CredentialId">("cred-ok"),
      crewMemberId: ME,
      type: "MMC",
      expiry: "2027-12-31",
    });
    expect((await buildCrewAppView(repo, ME, NOW))!.credentialNudge).toBeNull();
  });

  it("credentialNudge names the expiring credential — same 60d window as the roster flag (#57)", async () => {
    const repo = await seed();
    await repo.saveCredential({
      id: asId<"CredentialId">("cred-soon"),
      crewMemberId: ME,
      type: "MMC",
      expiry: "2026-08-12", // inside 60d of NOW
    });
    const view = await buildCrewAppView(repo, ME, NOW);
    expect(view!.credentialNudge).toEqual({
      type: "MMC",
      expiry: "2026-08-12",
      health: "expiring_soon",
    });
  });

  it("credentialNudge flags expired as expired", async () => {
    const repo = await seed();
    await repo.saveCredential({
      id: asId<"CredentialId">("cred-dead"),
      crewMemberId: ME,
      type: "MMC",
      expiry: "2026-06-01",
    });
    expect((await buildCrewAppView(repo, ME, NOW))!.credentialNudge!.health).toBe(
      "expired",
    );
  });
});
