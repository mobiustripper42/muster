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

  it("lists confirmed upcoming shifts soonest-first, drops past ones", async () => {
    const view = await buildCrewAppView(await seed(), ME, NOW);
    expect(view!.shifts.map((s) => s.shiftId)).toEqual(["shift-up", "shift-ask"]);
    expect(view!.shifts[0]).toMatchObject({ vesselName: "Hops", roleName: "captain", date: "2026-07-04" });
  });

  it("standing reads neutral with no history (null score)", async () => {
    const view = await buildCrewAppView(await seed({ score: null }), ME, NOW);
    expect(view!.standing).toEqual({ hasHistory: false, line: "No history yet — you read neutral." });
  });

  it("standing reads in-good-standing once a score exists", async () => {
    const view = await buildCrewAppView(await seed({ score: 7 }), ME, NOW);
    expect(view!.standing.hasHistory).toBe(true);
  });
});
