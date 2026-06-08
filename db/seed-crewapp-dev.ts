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
import {
  logAskAccepted,
  logAskIgnored,
  logAtRiskRescue,
  logEscalationAccepted,
  logNoShow,
  logShiftBailed,
  logShiftCompleted,
} from "../src/oracle/reliability-log.js";
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

  // crew-dooley: a busy reliability history, so /crew shows the worst-case
  // standing line (every reason kind at once — #32). No shifts/asks of his own;
  // this seed is purely to eyeball the standing subline wrapping + neutral tone.
  const DOOLEY = asId<"CrewMemberId">("crew-dooley");
  await repo.saveCrewMember({ id: DOOLEY, name: "Dooley", phone: "+15555550103", ratings: [CAPTAIN], status: "active", reliabilityScore: null });

  // The reliability log is append-only (no upsert), so only seed it once — re-runs
  // would otherwise duplicate. Past timestamps (all before any plausible `now`) so
  // nothing is dropped by the future-event guard.
  if ((await repo.reliabilityEventsFor(DOOLEY)).length === 0) {
    const S = (n: string) => asId<"ShiftId">(`dooley-${n}`);
    const SEAT = (n: string) => asId<"SeatId">(`dooley-seat-${n}`);
    const day = (d: number) => new Date(`2026-05-${String(d).padStart(2, "0")}T12:00:00.000Z`);
    const HOURS = 60 * 60 * 1000;
    for (let i = 1; i <= 6; i++) await logShiftCompleted(repo, DOOLEY, S(`done-${i}`), day(i)); // showed 6/9
    await logAskAccepted(repo, DOOLEY, SEAT("ask1"), S("ask1"), day(7), 5 * 60 * 1000); // answered fast
    await logEscalationAccepted(repo, DOOLEY, SEAT("esc"), S("esc"), day(8)); // stepped up…
    await logAtRiskRescue(repo, DOOLEY, SEAT("rescue"), S("rescue"), day(9)); // …two times
    await logShiftBailed(repo, DOOLEY, S("latebail"), day(10), 30 * HOURS); // one late bail (>= 24h)
    await logShiftBailed(repo, DOOLEY, S("earlybail"), day(11), 1 * HOURS); // one early bail (< 24h)
    await logNoShow(repo, DOOLEY, S("noshow"), day(12)); // one no-show
    await logAskIgnored(repo, DOOLEY, SEAT("ig1"), S("ig1"), day(13)); // missed two asks
    await logAskIgnored(repo, DOOLEY, SEAT("ig2"), S("ig2"), day(14));
  }

  console.log("Seeded crew-quint: 1 confirmed shift (2 events, manifest, co-crew Hooper), 1 open ask.");
  console.log("Seeded crew-dooley: full reliability log → worst-case standing line. View: /crew/dev-link?crew=crew-dooley");
} finally {
  await repo.close();
}
