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
const VESSEL = asId<"VesselId">("vessel-hops");
const QUINT = asId<"CrewMemberId">("crew-quint");

// near-future dates relative to a fixed seed day (kept deterministic, not `now`)
const SOON = "2026-07-04";
const LATER = "2026-07-05";

try {
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
  await repo.saveVessel({
    id: VESSEL,
    name: "Hops",
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 2 }],
  });
  await repo.saveCrewMember({
    id: QUINT,
    name: "Quint",
    phone: "+15555550101",
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
  });

  // A confirmed upcoming shift → my-shifts.
  await repo.saveShift({ id: asId<"ShiftId">("shift-soon"), vesselId: VESSEL, date: SOON, state: "Crewed", eventIds: [] });
  await repo.saveSeat({ id: asId<"SeatId">("seat-soon"), shiftId: asId<"ShiftId">("shift-soon"), role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: QUINT });

  // An open ask → the In/Out card.
  await repo.saveShift({ id: asId<"ShiftId">("shift-ask"), vesselId: VESSEL, date: LATER, state: "Filling", eventIds: [] });
  await repo.saveSeat({ id: asId<"SeatId">("seat-ask"), shiftId: asId<"ShiftId">("shift-ask"), role: CAPTAIN, kind: "required", state: "Asked" });
  await repo.saveAsk({ id: asId<"AskId">("ask-quint-1"), seatId: asId<"SeatId">("seat-ask"), crewMemberId: QUINT, channel: "push", sentAt: "2026-07-01T09:00:00.000Z" });

  console.log("Seeded crew-quint: 1 confirmed shift, 1 open ask.");
} finally {
  await repo.close();
}
