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
 * Produces two canonical party days:
 *   • Split Demo — 5 trips, morning cluster (9:00 / 10:30 / 12:00) + evening cluster
 *     (7:00 / 8:30) with a ~7h gap → the Builder flags "could be two shifts" and the
 *     cut dropdown is a real choice. Crewed so a split visibly PRESERVES side A's crew.
 *   • Steady — 3 tight afternoon trips (1:00 / 3:00 / 5:00), NO gap → no suggestion,
 *     but the Split control is STILL there (splitting isn't gated on a gap). Uncrewed.
 * Plus two spare crew to fill the far side. Then:
 *   /crew/dev-link?admin=spink → /admin/shifts?mode=edit
 *   1. Split either day at any cut → side A (before) + side B (from), born fresh.
 *   2. Crew side B, then Merge (8.4) → the far crew get a release notice.
 *
 * Idempotent: entity writes are upserts; `formShifts` preserves seat state on re-run.
 */
import { fileURLToPath } from "node:url";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import type { VesselId } from "../src/domain/ids.js";
import { formShifts } from "../src/builder/form-shifts.js";
import { TENANT_TIMEZONE } from "../src/config/tenant.js";
import type { Repository } from "../src/ports/repository.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const TENANT = asId<"TenantId">("tenant-brewboat"); // match app TENANT_ID + canonical seeds
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-split-demo"); // Day 1 — gappy, crewed
const VESSEL2 = asId<"VesselId">("vessel-split-tight"); // Day 2 — tight, uncrewed
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

export async function seedSplit(repo: Repository): Promise<void> {
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

  /** Seed a vessel-day's scheduled trips + a booking each; `formShifts` (called once,
   * after all days) turns each into a canonical shift with engine-derived seats. */
  async function seedDay(
    vesselId: VesselId,
    keyPrefix: string,
    date: string,
    trips: Array<{ time: string; pax: number }>,
  ) {
    for (const [i, trip] of trips.entries()) {
      const eventId = asId<"EventId">(`evt-${keyPrefix}-${i}`);
      await repo.saveEvent({
        id: eventId,
        vesselId,
        date,
        time: trip.time,
        capacity: 12,
        source: "xola", status: "scheduled",
        dock: DOCK,
      });
      await repo.saveReservation({
        id: asId<"ReservationId">(`resv-${keyPrefix}-${i}`),
        eventId,
        source: "xola",
        customerName: `Party ${i + 1}`,
        partySize: trip.pax,
        status: "booked",
      });
    }
  }

  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
  await repo.saveRoleType({ id: MATE, tenantId: TENANT, name: "mate" });

  // Two 2-crew BrewBoat party boats (captain + mate) — matches the real manning.
  const manning = [
    { roleTypeId: CAPTAIN, count: 1 },
    { roleTypeId: MATE, count: 1 },
  ];
  await repo.saveVessel({ id: VESSEL, name: "Split Demo", coiMaxPax: 12, manning });
  await repo.saveVessel({ id: VESSEL2, name: "Steady", coiMaxPax: 12, manning });

  const cap = await crew("crew-split-cap", "Quill", CAPTAIN, "+15555550201");
  const mate = await crew("crew-split-mate", "Reef", MATE, "+15555550202");
  await crew("crew-split-cap2", "Dale", CAPTAIN, "+15555550203"); // spare, far side
  await crew("crew-split-mate2", "Wren", MATE, "+15555550204"); // spare, far side

  // Day 1 (Split Demo, ~3d out): a morning + evening cluster with a ~7h afternoon
  // gap — the Builder flags "could be two shifts" AND the cut dropdown is a real
  // choice (10:30 / 12:00 / 7:00 / 8:30), with the gap driving a sensible default.
  const gapDate = dateOf(at(3 * 24));
  await seedDay(VESSEL, "split", gapDate, [
    { time: "09:00", pax: 6 },
    { time: "10:30", pax: 4 },
    { time: "12:00", pax: 2 },
    { time: "19:00", pax: 8 },
    { time: "20:30", pax: 5 },
  ]);

  // Day 2 (Steady, ~4d out): a tight afternoon, NO long gap → no split suggestion,
  // but the Split control STILL appears (splitting isn't gated on a gap — the "long
  // break" note is only a suggestion). Left uncrewed to show splitting a plain day.
  const tightDate = dateOf(at(4 * 24));
  await seedDay(VESSEL2, "tight", tightDate, [
    { time: "13:00", pax: 5 },
    { time: "15:00", pax: 7 },
    { time: "17:00", pax: 3 },
  ]);

  // Build both the production way: formShifts → canonical `shift-{vessel}-{date}`
  // ids + engine-derived seats (so a later split partitions + preserves crew cleanly).
  await formShifts(repo);
  const gapShift = asId<"ShiftId">(`shift-${VESSEL}-${gapDate}`);
  const tightShift = asId<"ShiftId">(`shift-${VESSEL2}-${tightDate}`);

  // Crew Day 1 (Confirmed) directly on the derived seats — a dev fixture, no ask
  // ceremony. State resolves on read (deriveAllShifts), so the board shows Crewed.
  for (const seat of await repo.listSeatsForShift(gapShift)) {
    const who = seat.role === CAPTAIN ? cap : seat.role === MATE ? mate : null;
    if (who) {
      await repo.saveSeat({ ...seat, state: "Confirmed", assignedCrewMemberId: who });
    }
  }

  console.log("Seeded split/merge demo — two canonical, production-shaped shifts:");
  console.log(`  1. Split Demo  ${gapDate}  09:00·10:30·12:00·19:00·20:30  (crewed; ~7h gap → suggestion + rich dropdown)`);
  console.log(`     ${gapShift}`);
  console.log(`  2. Steady      ${tightDate}  13:00·15:00·17:00              (uncrewed; no gap → no suggestion, still splittable)`);
  console.log(`     ${tightShift}`);
  console.log("");
  console.log("Test:  /crew/dev-link?admin=spink → /admin/shifts?mode=edit");
  console.log("  • Split Demo — Split at 7:00 PM (suggested) or pick another → side A (morning, keeps Quill+Reef) + side B (evening).");
  console.log("  • Steady — no 'could be two shifts' hint, but the Split control is still there. Split at 3:00 or 5:00.");
  console.log("  • Crew a far side, then Merge (8.4) → the far crew get a release notice.");
  console.log("");
  console.log("⚠  Run on a CLEAN DB — splitting fires formShifts globally; any non-canonical");
  console.log("   scenario-seed shift (atrisk/crewapp/outbox) would duplicate. Reset before seeding.");
}

// CLI entry: `npm run db:seed:split`. Skipped when imported by db:all (--split).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const repo = PostgresRepository.fromConnectionString(url);
  try {
    await seedSplit(repo);
  } finally {
    await repo.close();
  }
}
