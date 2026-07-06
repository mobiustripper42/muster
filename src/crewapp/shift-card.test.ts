import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type {
  CrewMember,
  Event,
  Reservation,
  RoleType,
  Seat,
  Shift,
  Vessel,
} from "../domain/entities.js";
import { buildShiftCard, CALL_LEAD_MINUTES } from "./shift-card.js";

const NOW = new Date("2026-07-01T08:00:00.000Z");
const TENANT = asId<"TenantId">("t");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-1");
const ME = asId<"CrewMemberId">("crew-me");
const CO = asId<"CrewMemberId">("crew-co");
const SHIFT = asId<"ShiftId">("shift-1");
const E1 = asId<"EventId">("evt-3pm");
const E5 = asId<"EventId">("evt-5pm");

async function seed(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  const roles: RoleType[] = [
    { id: CAPTAIN, tenantId: TENANT, name: "captain" },
    { id: MATE, tenantId: TENANT, name: "mate" },
  ];
  const vessel: Vessel = { id: VESSEL, name: "Hops", coiMaxPax: 12, manning: [{ roleTypeId: CAPTAIN, count: 1 }, { roleTypeId: MATE, count: 1 }] };
  const me: CrewMember = { id: ME, name: "Quint", phone: "555-0001", ratings: [CAPTAIN], status: "active", reliabilityScore: null };
  const co: CrewMember = { id: CO, name: "Hooper", phone: "555-0002", ratings: [MATE], status: "active", reliabilityScore: null };
  const shift: Shift = { id: SHIFT, vesselId: VESSEL, date: "2026-07-04", state: "Crewed", eventIds: [E5, E1] /* out of order on purpose */ };
  // Two events, different docks/times; the 5pm listed first to test sorting.
  const e3: Event = { id: E1, vesselId: VESSEL, date: "2026-07-04", time: "15:00", capacity: 12, status: "scheduled", dock: "Pier 9, Lake Union" };
  const e5: Event = { id: E5, vesselId: VESSEL, date: "2026-07-04", time: "17:00", capacity: 12, status: "scheduled" /* no dock */ };
  const seats: Seat[] = [
    { id: asId<"SeatId">("seat-cap"), shiftId: SHIFT, role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: ME },
    { id: asId<"SeatId">("seat-mate"), shiftId: SHIFT, role: MATE, kind: "required", state: "Confirmed", assignedCrewMemberId: CO },
  ];
  const reservations: Reservation[] = [
    { id: asId<"ReservationId">("r1"), eventId: E1, customerName: "Brody", partySize: 4, phone: "555-1111", status: "booked" },
    { id: asId<"ReservationId">("r2"), eventId: E1, customerName: "Vaughn", partySize: 6, status: "booked" }, // no phone
    { id: asId<"ReservationId">("r3"), eventId: E1, customerName: "Cancelled Carl", partySize: 8, status: "cancelled" }, // excluded
    { id: asId<"ReservationId">("r4"), eventId: E5, customerName: "Ellen", partySize: 2, status: "booked" },
  ];
  for (const r of roles) await repo.saveRoleType(r);
  await repo.saveVessel(vessel);
  await repo.saveCrewMember(me);
  await repo.saveCrewMember(co);
  await repo.saveShift(shift);
  await repo.saveEvent(e3);
  await repo.saveEvent(e5);
  for (const s of seats) await repo.saveSeat(s);
  for (const r of reservations) await repo.saveReservation(r);
  return repo;
}

describe("buildShiftCard", () => {
  it("null when the viewer isn't confirmed crew on the shift", async () => {
    const repo = await seed();
    expect(await buildShiftCard(repo, SHIFT, asId<"CrewMemberId">("stranger"), NOW)).toBeNull();
  });

  it("null when the shift doesn't exist", async () => {
    const repo = await seed();
    expect(await buildShiftCard(repo, asId<"ShiftId">("ghost"), ME, NOW)).toBeNull();
  });

  it("call time = earliest departure minus the flat lead", async () => {
    const card = (await buildShiftCard(await seed(), SHIFT, ME, NOW))!;
    expect(CALL_LEAD_MINUTES).toBe(45);
    expect(card.callTime).toBe("14:15"); // earliest departure 15:00 − 45m
    expect(card.vesselName).toBe("Hops");
    expect(card.viewerRole).toBe("captain");
    expect(card.mySeatId).toBe("seat-cap"); // what a bail acts on (#56)
  });

  it("shift end = latest departure + trip length + call lead (DEC-041)", async () => {
    const card = (await buildShiftCard(await seed(), SHIFT, ME, NOW))!;
    // latest departure 17:00 + (100 trip + 45 lead) = 17:00 + 2h25m = 19:25
    expect(card.shiftEndTime).toBe("19:25");
  });

  it("a cancelled later trip moves neither the window's start nor end (DEC-041)", async () => {
    const repo = await seed();
    // A 9pm trip exists but is CANCELLED — must not anchor the shift end; the
    // window stays the scheduled 15:00–17:00 span, same as the other surfaces.
    const E9 = asId<"EventId">("evt-9pm");
    await repo.saveEvent({ id: E9, vesselId: VESSEL, date: "2026-07-04", time: "21:00", capacity: 12, status: "cancelled" });
    await repo.saveShift({ id: SHIFT, vesselId: VESSEL, date: "2026-07-04", state: "Crewed", eventIds: [E5, E1, E9] });
    const card = (await buildShiftCard(repo, SHIFT, ME, NOW))!;
    expect(card.callTime).toBe("14:15"); // earliest SCHEDULED 15:00 − 45m
    expect(card.shiftEndTime).toBe("19:25"); // latest SCHEDULED 17:00, not the cancelled 21:00
  });

  it("manifest is per-event, soonest first, booked-only with pax", async () => {
    const card = (await buildShiftCard(await seed(), SHIFT, ME, NOW))!;
    expect(card.events.map((e) => e.eventId)).toEqual(["evt-3pm", "evt-5pm"]); // sorted by time
    const three = card.events[0]!;
    expect(three.dock).toBe("Pier 9, Lake Union");
    expect(three.pax).toBe(10); // 4 + 6, cancelled 8 excluded
    expect(three.guests.map((g) => g.name)).toEqual(["Brody", "Vaughn"]);
    expect("phone" in three.guests[1]!).toBe(false); // Vaughn has no phone
    expect("dock" in card.events[1]!).toBe(false); // 5pm event has no dock
    expect(card.paxTotal).toBe(12); // 10 + 2
    expect(card.sharedDock).toBeUndefined(); // docks differ (one absent) → per-event
  });

  it("sharedDock is set only when every event departs the same place", async () => {
    const repo = await seed();
    // give the 5pm event the same dock as the 3pm → now they share
    await repo.saveEvent({ id: E5, vesselId: VESSEL, date: "2026-07-04", time: "17:00", capacity: 12, status: "scheduled", dock: "Pier 9, Lake Union" });
    const card = (await buildShiftCard(repo, SHIFT, ME, NOW))!;
    expect(card.sharedDock).toBe("Pier 9, Lake Union");
  });

  it("co-crew lists the other confirmed crew with contact, excludes the viewer", async () => {
    const card = (await buildShiftCard(await seed(), SHIFT, ME, NOW))!;
    expect(card.coCrew).toEqual([{ crewMemberId: "crew-co", name: "Hooper", phone: "555-0002", role: "mate" }]);
  });

  it("bailLate is true when a bail now falls inside the staffing horizon (#7)", async () => {
    // Trip 2026-07-04; NOW 2026-07-01 → ~3 days notice, well inside the 7-day lead.
    const card = (await buildShiftCard(await seed(), SHIFT, ME, NOW))!;
    expect(card.bailLate).toBe(true);
  });

  it("bailLate is false with more than the staffing-horizon's notice (#7)", async () => {
    // Same trip, but two weeks out → notice exceeds the lead → graceful.
    const early = new Date("2026-06-20T08:00:00.000Z");
    const card = (await buildShiftCard(await seed(), SHIFT, ME, early))!;
    expect(card.bailLate).toBe(false);
  });

  it("bailLate is false for an event-less shift — no horizon to be late against (#7)", async () => {
    const repo = await seed();
    // Strip the shift's events so there's no scheduled trip to anchor a horizon.
    await repo.saveShift({ id: SHIFT, vesselId: VESSEL, date: "2026-07-04", state: "Crewed", eventIds: [] });
    const card = (await buildShiftCard(repo, SHIFT, ME, NOW))!;
    expect(card.bailLate).toBe(false);
    expect(card.callTime).toBeUndefined();
    expect(card.shiftEndTime).toBeUndefined(); // no trip → no end
  });
});
