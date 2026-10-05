/**
 * `db:seed:departure` — the departure page's state (Phase 18.8, issue #1122): a trip that was
 * counted, two people ticked aboard, and the waiver version its signers accepted, so the warning,
 * the checked-in lines and the waiver text all have something to show.
 *
 * **Run `db:seed:reservation` first, the same day.** This writes onto that seed's first booking
 * (Marcus Webb, party of 8), whose signers — Marcus, his minor Lily, Fred Kowalski twice, Grace
 * Kim — it already plants. Then it adds:
 *
 * - a crew member, **Mike Rossi** (`crew-seed-departure-mike`), the mate who counts and ticks;
 * - a waiver version effective Jan 1, 2026, given to every signer on that booking who has none;
 * - Marcus and Grace ticked aboard by Mike, at 1:51 and 1:52 PM on the trip's day;
 * - the count: **6 aboard**, by Mike at 1:58 PM — four more than were checked in.
 *
 * **Re-running resets it** to exactly that: the count and the two ticks are set again.
 */
import { existsSync } from "node:fs";
import pg from "pg";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { pgConnectionConfig } from "../src/config/db-ssl.js";
import { vesselDateOf, zonedWallClockToInstant } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import { demoReservationId, reservationDemo } from "../src/reservations/seed-reservation.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const forced = process.argv.slice(2).some((a) => a === "--force" || a.startsWith("--force="));
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

// Local-DB guard: this writes synthetic rows — never a shared/prod DB by accident.
const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !forced) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed writes synthetic rows — run it against a local DB, or pass --force.`,
  );
  process.exit(1);
}

const MIKE = asId<"CrewMemberId">("crew-seed-departure-mike");
const WAIVER = asId<"WaiverTemplateId">("wt-seed-departure");

const repo = PostgresRepository.fromConnectionString(url);
const client = new pg.Client(pgConnectionConfig(url));
await client.connect();

try {
  // The same booking `db:seed:reservation` makes first today — its id is derived, not stored.
  const first = reservationDemo(process.env.SEED_TODAY ?? vesselDateOf(new Date())).bookings[0]!;
  const reservationId = asId<"ReservationId">(demoReservationId(first.date, first.time, ...(first.vesselId ? [first.vesselId] : [])));
  const booking = await repo.getReservation(reservationId);
  const signers = booking ? await repo.listGuestsForReservation(reservationId) : [];
  if (!booking?.eventId || signers.length === 0) {
    console.error("No signed booking from `db:seed:reservation` today — run `npm run db:seed:reservation` first.");
    process.exit(1);
  }
  const eventId = booking.eventId;
  const admin = (await repo.listAdmins()).find((a) => a.active);
  if (!admin) {
    console.error("No active admin to post the waiver version — run `npm run db:seed:crew` first.");
    process.exit(1);
  }

  if (!(await repo.listCrewMembers()).some((c) => c.id === MIKE)) {
    await repo.saveCrewMember({
      id: MIKE,
      name: "Mike Rossi",
      phone: "+12165550177",
      ratings: [],
      status: "active",
      reliabilityScore: null,
    });
  }

  if (!(await repo.getWaiverTemplate(WAIVER))) {
    await repo.postWaiverTemplate({
      id: WAIVER,
      version: "seed-departure-v1",
      body:
        "VOYAGE AGREEMENT\n\nI understand that a river cruise carries risks, including slips, falls and weather.\n\n" +
        "I accept those risks for myself and any minor I sign for.",
      effectiveFrom: zonedWallClockToInstant("2026-01-01", "00:00").toISOString(),
      postedAt: new Date().toISOString(),
      postedBy: String(admin.id),
    });
  }
  // A signing is insert-only through the port; the version a seeded signer accepted is set here,
  // and only where none is, so a real signature is never relabelled.
  await client.query(
    "update guests set waiver_template_id = $2 where reservation_id = $1 and signed_at is not null and waiver_template_id is null",
    [reservationId, WAIVER],
  );

  const onTheDay = (hhmm: string) => zonedWallClockToInstant(first.date, hhmm).toISOString();
  for (const g of signers) await repo.setGuestCheckIn(g.id, null);
  await repo.setGuestCheckIn(asId<"GuestId">("seed-guest-marcus"), { at: onTheDay("13:51"), by: MIKE });
  await repo.setGuestCheckIn(asId<"GuestId">("seed-guest-grace"), { at: onTheDay("13:52"), by: MIKE });
  await repo.setDepartureCount(eventId, { pax: 6, countedAt: onTheDay("13:58"), countedBy: MIKE });

  console.log(`✓ Seeded the departure page's state on ${booking.customerName}'s booking.`);
  console.log(`  trip      ${first.date} ${first.time}`);
  console.log(`  page      /admin/departure/${encodeURIComponent(String(eventId))}`);
  console.log(`  pane      /admin/calendar/${encodeURIComponent(String(reservationId))}?date=${first.date}`);
  console.log(`  count     6 aboard by Mike Rossi · 2 checked in (Marcus, Grace) · 4 signed`);
} finally {
  await client.end();
  await repo.close();
}
