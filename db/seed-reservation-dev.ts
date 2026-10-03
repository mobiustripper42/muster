/**
 * `db:seed:reservation` — seed a self-contained reservation world so the /admin/blocks impact
 * numbers are real when hand-testing (task 12.10, DEC-125). It materializes:
 *   - the crewed fleet (seedFleet — so vessel-brew-3 exists), a demo Location + a LIVE Offering
 *     (3 daily departures, season scoped to the demo window);
 *   - two MATERIALIZED bookings (Event + booked Reservation) at known slots inside that window;
 *   - waiver signings on the first booking, for the booker's party page (18.6).
 *
 * Then a Vessel block over the printed window, or a Location block on the printed day, shows a
 * non-zero "removes N" AND a booked-trip conflict. **The dates are relative to today (#646)** —
 * a seven-day window late in NEXT month — so the fixture never expires; the exact days are
 * printed below, which is the only place to read them from.
 *
 *   npm run db:seed:reservation           # local/preview DB
 *   npm run db:seed:reservation --force   # bypass the local-DB guard
 *
 * Idempotent **within a day**: ids embed the derived dates, so re-running after the month rolls
 * writes a fresh window rather than upserting the old one. Re-seed from scratch if that matters.
 */
import { existsSync } from "node:fs";
import { resolveCustomerId } from "../src/customers/resolve.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { seedFleet } from "../src/import/resource-map.js";
import {
  buildSeededReservationWorld,
  demoBookingCode,
  demoRevokedBookingCode,
  reservationDemo,
} from "../src/reservations/seed-reservation.js";
import { addDays, vesselDateOf } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

// Local-DB guard (mirrors db:seed:gratuity / db:seed:split): this writes synthetic rows — never
// a shared/prod or preview DB by accident.
const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed writes synthetic rows — run it against a local/preview DB, or pass --force.`,
  );
  process.exit(1);
}

const repo = PostgresRepository.fromConnectionString(url);
try {
  await seedFleet(repo); // vessels + role types — vessel-brew-3 must exist for the offering
  // The core builder stays pure; the script supplies today (#646). `SEED_TODAY` lets a caller
  // pin the day — the e2e harness sets it so the seeded DB and the specs' expectations come from
  // one clock read instead of two that can disagree across a midnight.
  const demo = reservationDemo(process.env.SEED_TODAY ?? vesselDateOf(new Date()));
  const world = buildSeededReservationWorld(new Date().toISOString(), demo);

  await repo.saveLocation(world.location);
  await repo.saveOffering(world.offering);
  for (const e of world.events) await repo.saveEvent(e);
  // Resolve each booking's customer the same way a real booking would (12.12b, DEC-132) —
  // get-or-create by canonical phone, so the two Marcus bookings collapse to ONE customer and
  // the tab has a repeat guest to show. Seeds are first-class fixtures; they must exercise the
  // real path, not hand-write customer rows the app would never produce.
  for (const r of world.reservations) {
    const customerId = await resolveCustomerId(
      repo,
      { customerName: r.customerName, ...(r.phone !== undefined ? { phone: r.phone } : {}) },
      () => r.updatedAt ?? new Date().toISOString(),
    );
    await repo.saveReservation({ ...r, ...(customerId !== undefined ? { customerId } : {}) });

    // The manage code (#741). Derived from the reservation id rather than random, so the URLs
    // printed below are reproducible and a spec can build one without querying. `if not exists`
    // semantics by hand: the PK throws on a re-seed within the same day, and a seed that dies on
    // its second run is a seed nobody re-runs.
    const code = demoBookingCode(String(r.id));
    if (!(await repo.getBookingCode(code))) {
      await repo.saveBookingCode({
        code,
        reservationId: r.id,
        createdAt: r.updatedAt ?? new Date().toISOString(),
      });
    }
  }

  // One REVOKED code on the first booking, so the "this booking link was replaced" state has a
  // starting URL. Without it that state is only reachable by pressing Replace-their-link first,
  // which makes it a step in someone else's test rather than a state you can open.
  const firstId = String(world.reservations[0]!.id);
  const revoked = demoRevokedBookingCode(firstId);
  if (!(await repo.getBookingCode(revoked))) {
    await repo.saveBookingCode({
      code: revoked,
      reservationId: world.reservations[0]!.id,
      createdAt: "2026-01-01T00:00:00.000Z",
      revokedAt: "2026-01-02T00:00:00.000Z",
    });
  }

  // Signings on the first booking (18.6), so the booker's party page has a state to open: an adult
  // with a minor, someone who signed twice (one person, "×2"), and one more — 4 of the party of 8.
  // Through the port, as a signing writes them; skipped when the booking already has signers, so a
  // re-run adds nothing.
  const first = world.reservations[0]!;
  if ((await repo.listGuestsForReservation(first.id)).length === 0) {
    const at = (hour: number) => `2026-01-05T${String(hour).padStart(2, "0")}:00:00.000Z`;
    const signer = (id: string, name: string, dob: string, hour: number) => ({
      id: asId<"GuestId">(`seed-guest-${id}`),
      eventId: first.eventId!,
      reservationId: first.id,
      name,
      email: `${id}@example.com`,
      dob,
      isMinor: false,
      signedAt: at(hour),
      signatureName: name,
      source: "self" as const,
      createdAt: at(hour),
    });
    const marcus = signer("marcus", "Marcus Webb", "1978-02-11", 9);
    await repo.saveGuests([
      marcus,
      { id: asId<"GuestId">("seed-guest-lily"), eventId: first.eventId!, reservationId: first.id, name: "Lily Webb", dob: "2015-05-14", isMinor: true, guardianGuestId: marcus.id, guardianRelation: "parent", source: "self", createdAt: at(9) },
      signer("fred-1", "Fred Kowalski", "1979-08-30", 10),
      signer("fred-2", "Fred Kowalski", "1979-08-30", 14),
      signer("grace", "Grace Kim", "1990-12-01", 11),
    ]);
  }

  const customers = await repo.listCustomers();
  console.log(`✓ Seeded reservation demo world (db: ${new URL(url).host}).`);
  console.log(`  customers ${customers.length} (${customers.map((c) => `${c.name} ${c.displayCode}`).join(", ")})`);
  console.log(`  offering  ${world.offering.id}  (LIVE, ${demo.departureTimes.join("/")})`);
  // Printed because the guest filter is only testable against boats of DIFFERENT sizes (#715),
  // and "which boats, at what capacity" is the first thing a hand-test needs to know.
  console.log(`  boats     ${demo.fleet.map((f) => `${f.name} (${f.coiMaxPax})`).join(", ")}  — the block suggestions below are ${demo.vesselName}'s`);
  console.log(`  window    ${demo.window.start} … ${demo.window.end}   (where the BOOKINGS are)`);
  // Printed separately from the window since #797: the two are different ranges now, and the
  // season is the one a hand test needs — it is every day you can book, including the near ones
  // that put a booking inside the 14-day cancellation window.
  console.log(`  season    ${demo.season.start} … ${demo.season.end}   (where you can BOOK — 14-day cutoff is ${addDays(vesselDateOf(new Date()), 14)})`);
  // Sorted and boat-labelled: the big-party fixtures (#715) put two hulls in one departure, and
  // "which boat" is the whole question a guest-count hand-test is asking.
  const boatName = (id: string | undefined) =>
    demo.fleet.find((f) => f.vesselId === (id ?? demo.vesselId))?.name ?? "?";
  for (const b of [...demo.bookings].sort((a, z) => `${a.date}${a.time}`.localeCompare(`${z.date}${z.time}`))) {
    console.log(
      `  booked    ${b.date} ${b.time}  ${boatName(b.vesselId).padEnd(6)} ${String(b.partySize).padStart(2)} guests  $${(b.priceCents / 100).toFixed(2).padStart(7)}  ${b.customerName}`,
    );
  }
  console.log("");
  console.log("Customer booking links (#741):");
  for (const r of world.reservations) {
    console.log(`  /b/${demoBookingCode(String(r.id))}   ${r.customerName}`);
  }
  console.log(`  /b/${demoRevokedBookingCode(firstId)}   REVOKED — the "link was replaced" state`);
  console.log(`  /b/${demoBookingCode(firstId)}/party   the party page — 4 of 8 signed, Fred Kowalski ×2, Lily Webb a minor`);
  console.log("");
  console.log("Try it at /admin/blocks:");
  console.log(`  • Vessel block ${demo.vesselName}  ${demo.vesselBlockWindow.start} → ${demo.vesselBlockWindow.end}  → removes slots + 2 booked ($988) conflict`);
  console.log(`  • Location block Reservation Demo Dock  ${demo.locationBlockWindow.date} ${demo.locationBlockWindow.startTime}–${demo.locationBlockWindow.endTime}  → removes 1 + 1 booked ($549) conflict`);
} finally {
  await repo.close();
}
