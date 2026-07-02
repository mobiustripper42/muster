/**
 * Dev seed for split/merge testing (8.3 Split / 8.4 Merge) — a real, production-
 * shaped canonical shift you can actually split and merge.
 *
 * WHY THIS EXISTS: the scenario seeds (atrisk / crewapp / outbox) hand-author
 * shifts with NON-canonical ids (`shift-ar-gappy`, …) and hand-set seat ids.
 * `formShifts` is global and keyed on `shift-{vessel}-{date}`, so the moment you
 * split ANY shift it re-forms every event's vessel-day and DUPLICATES those
 * non-canonical shifts (the "two rows, same times" trap). This seed sidesteps that
 * by building its data THROUGH `formShifts` — canonical shift id + engine-derived
 * seats — exactly like a real Xola import produces.
 *
 * ⚠ RUN ON A CLEAN DB. Splitting fires `formShifts` globally, so any non-canonical
 *   shift left in the DB would duplicate. Reset first and don't load the scenario
 *   seeds alongside:
 *     docker compose down -v && npm run db:up && npm run db:migrate && npm run db:seed:split
 *
 * Produces one 3-trip party day (11:00 / 18:00 / 20:00 — a morning trip + an
 * evening cluster, ~7h gap → the Builder flags "could be two shifts"), crewed
 * (captain + mate confirmed) so a split visibly PRESERVES side A's crew, plus two
 * spare crew to fill the far side. Then:
 *   /crew/dev-link?admin=spink → /admin/shifts?mode=edit
 *   1. Split at 6:00 PM → side A (11:00, keeps Quill + Reef) + side B (18:00, 20:00, born fresh).
 *   2. Crew side B, then Merge (8.4) → the far crew get a release notice.
 *
 * Idempotent: entity writes are upserts; `formShifts` preserves seat state on re-run.
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import { formShifts } from "../src/builder/form-shifts.js";
import { TENANT_TIMEZONE } from "../src/config/tenant.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

const TENANT = asId<"TenantId">("brewboat");
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-split-demo");
const DOCK = "East Bank of the Flats at Canal Basin Park";

// A trip N hours out, stored as vessel-local wall-clock date (DEC-032).
const at = (hours: number) => new Date(Date.now() + hours * 3600_000);
const dateOf = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TENANT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

const MMC_GOOD = "2027-12-31";

async function crew(
  id: string,
  name: string,
  role: typeof CAPTAIN | typeof MATE,
  phone: string,
) {
  const crewId = asId<"CrewMemberId">(id);
  await repo.saveCrewMember({
    id: crewId,
    name,
    phone,
    ratings: [role],
    status: "active",
    reliabilityScore: null,
  });
  await repo.saveCredential({
    id: asId<"CredentialId">(`cred-${id}`),
    crewMemberId: crewId,
    type: "MMC",
    expiry: MMC_GOOD,
  });
  return crewId;
}

try {
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
  await repo.saveRoleType({ id: MATE, tenantId: TENANT, name: "mate" });

  // A 2-crew BrewBoat party boat (captain + mate) — matches the real manning.
  await repo.saveVessel({
    id: VESSEL,
    name: "Split Demo",
    coiMaxPax: 12,
    manning: [
      { roleTypeId: CAPTAIN, count: 1 },
      { roleTypeId: MATE, count: 1 },
    ],
  });

  const cap = await crew("crew-split-cap", "Quill", CAPTAIN, "+15555550201");
  const mate = await crew("crew-split-mate", "Reef", MATE, "+15555550202");
  await crew("crew-split-cap2", "Dale", CAPTAIN, "+15555550203"); // spare, far side
  await crew("crew-split-mate2", "Wren", MATE, "+15555550204"); // spare, far side

  const date = dateOf(at(3 * 24)); // ~3 days out — inside the default next-7 window
  const times = ["11:00", "18:00", "20:00"];
  for (const [i, time] of times.entries()) {
    const eventId = asId<"EventId">(`evt-split-${i}`);
    await repo.saveEvent({
      id: eventId,
      vesselId: VESSEL,
      date,
      time,
      capacity: 12,
      status: "scheduled",
      dock: DOCK,
    });
    await repo.saveReservation({
      id: asId<"ReservationId">(`resv-split-${i}`),
      eventId,
      customerName: `Party ${i + 1}`,
      partySize: 4,
      status: "booked",
    });
  }

  // Build the shift the production way: formShifts → canonical `shift-{vessel}-{date}`
  // + engine-derived seats (so a later split partitions + preserves crew cleanly).
  await formShifts(repo);
  const shiftId = asId<"ShiftId">(`shift-${VESSEL}-${date}`);

  // Crew it (Confirmed) directly on the derived seats — a dev fixture, no ask
  // ceremony. State is resolved on read (deriveAllShifts), so the board shows Crewed.
  for (const seat of await repo.listSeatsForShift(shiftId)) {
    const who = seat.role === CAPTAIN ? cap : seat.role === MATE ? mate : null;
    if (who) {
      await repo.saveSeat({ ...seat, state: "Confirmed", assignedCrewMemberId: who });
    }
  }

  console.log("Seeded split/merge demo — one canonical, production-shaped shift:");
  console.log(`  Shift:  ${shiftId}`);
  console.log(`  Vessel: Split Demo   Date: ${date}   Trips: ${times.join(" · ")}`);
  console.log("  Crewed: Quill (captain) + Reef (mate); Dale + Wren spare for the far side.");
  console.log("");
  console.log("Test:  /crew/dev-link?admin=spink → /admin/shifts?mode=edit");
  console.log("  1. Split at 6:00 PM → side A (11:00, keeps Quill + Reef) + side B (18:00, 20:00).");
  console.log("  2. Crew side B, then Merge (8.4) → the far crew get a release notice.");
  console.log("");
  console.log("⚠  Run on a CLEAN DB — splitting fires formShifts globally; any non-canonical");
  console.log("   scenario-seed shift (atrisk/crewapp/outbox) would duplicate. Reset before seeding.");
} finally {
  await repo.close();
}
