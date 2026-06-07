/**
 * Dev seed for the Crew App (SPEC §2.6). Populates enough state to exercise the
 * crew surfaces by hand: one crew member ("crew-quint") with one CONFIRMED
 * upcoming shift (shows in my-shifts) and one OPEN ask (shows the In/Out card).
 *
 * Idempotent — every write is an upsert. Run against local dev Postgres:
 *   docker compose up -d && npm run db:migrate && npx tsx db/seed-crewapp-dev.ts
 * Then: GET /crew/dev-link?crew=crew-quint → tap the link → /crew.
 *
 * Dev tooling, not app code. Uses the same Postgres adapter the app runs on.
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

const TENANT = asId<"TenantId">("brewboat");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-hops");
const QUINT = asId<"CrewMemberId">("crew-quint");
const HOOPER = asId<"CrewMemberId">("crew-hooper");

// near-future dates relative to a fixed seed day (kept deterministic, not `now`)
const SOON = "2026-07-04";
const LATER = "2026-07-05";

try {
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
  await repo.saveRoleType({ id: MATE, tenantId: TENANT, name: "mate" });
  await repo.saveVessel({
    id: VESSEL,
    name: "Hops",
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }, { roleTypeId: MATE, count: 1 }],
  });
  await repo.saveCrewMember({ id: QUINT, name: "Quint", phone: "+15555550101", ratings: [CAPTAIN], status: "active", reliabilityScore: null });
  await repo.saveCrewMember({ id: HOOPER, name: "Hooper", phone: "+15555550102", ratings: [MATE], status: "active", reliabilityScore: null });

  // A confirmed upcoming shift with two events (3pm + 5pm, different docks) →
  // my-shifts row → the shift card (call/departure times, dock pins, per-event
  // manifest, co-crew). Quint (captain) + Hooper (mate) both confirmed.
  const SHIFT_SOON = asId<"ShiftId">("shift-soon");
  const E3 = asId<"EventId">("evt-soon-3pm");
  const E5 = asId<"EventId">("evt-soon-5pm");
  await repo.saveShift({ id: SHIFT_SOON, vesselId: VESSEL, date: SOON, state: "Crewed", eventIds: [E3, E5] });
  await repo.saveEvent({ id: E3, vesselId: VESSEL, date: SOON, time: "15:00", capacity: 12, status: "scheduled", dock: "Pier 9, Lake Union, Seattle" });
  await repo.saveEvent({ id: E5, vesselId: VESSEL, date: SOON, time: "17:00", capacity: 12, status: "scheduled", dock: "Pier 9, Lake Union, Seattle" });
  await repo.saveSeat({ id: asId<"SeatId">("seat-soon-cap"), shiftId: SHIFT_SOON, role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: QUINT });
  await repo.saveSeat({ id: asId<"SeatId">("seat-soon-mate"), shiftId: SHIFT_SOON, role: MATE, kind: "required", state: "Confirmed", assignedCrewMemberId: HOOPER });
  // Manifest: different guests on each event (the hinge).
  await repo.saveReservation({ id: asId<"ReservationId">("r-3pm-1"), eventId: E3, customerName: "Brody party", partySize: 4, phone: "+15555551111", status: "booked" });
  await repo.saveReservation({ id: asId<"ReservationId">("r-3pm-2"), eventId: E3, customerName: "Vaughn party", partySize: 6, status: "booked" });
  await repo.saveReservation({ id: asId<"ReservationId">("r-5pm-1"), eventId: E5, customerName: "Ellen party", partySize: 2, phone: "+15555552222", status: "booked" });

  // An open ask → the In/Out card on /crew.
  await repo.saveShift({ id: asId<"ShiftId">("shift-ask"), vesselId: VESSEL, date: LATER, state: "Filling", eventIds: [] });
  await repo.saveSeat({ id: asId<"SeatId">("seat-ask"), shiftId: asId<"ShiftId">("shift-ask"), role: CAPTAIN, kind: "required", state: "Asked" });
  await repo.saveAsk({ id: asId<"AskId">("ask-quint-1"), seatId: asId<"SeatId">("seat-ask"), crewMemberId: QUINT, channel: "push", sentAt: "2026-07-01T09:00:00.000Z" });

  console.log("Seeded crew-quint: 1 confirmed shift (2 events, manifest, co-crew Hooper), 1 open ask.");
} finally {
  await repo.close();
}
