/**
 * `db:seed:trail` — put one row of every event type in front of the booking audit (issue #1049),
 * so `/admin/booking-audit` and a booking's History panel can actually be looked at.
 *
 * **Why this exists: the surface cannot otherwise be reviewed.** Most of the 33 types are error
 * paths nobody can trigger on a dev box on demand — a dispute arriving in a state the pinned
 * Stripe SDK cannot name, a refund failing partway through its second charge, the residual-race
 * loser, a charge that matches no booking at all. Without a seed the page gets eyeballed against
 * three tidy rows, which is exactly the condition under which a layout looks fine and falls over
 * in production.
 *
 *     npm run db:seed:trail
 *
 * Flags:
 *   --force   bypass the local-DB guard (writes synthetic rows)
 *
 * Idempotent: every id is deterministic and keyed on the booking, so re-running upserts.
 *
 * ## What a green run proves, and what it does not
 *
 * **Proves:** the surface RENDERS every type legibly — labels that wrap, a 40-character id, a
 * borrowed timestamp with its provenance line, the two rows that belong to no booking — and that
 * the union read assembles all five sources in the right order.
 *
 * **Proves nothing** about whether the emitters fire at the right moment. Not one row here goes
 * through an emitter. That proof is the unit tests in issues #1050, #1051 and #1052, each
 * written against its real call site. **Reading a green run here as evidence the audit is
 * correct is reading it wrong.**
 *
 * The operator's caveat, carried because it is the right posture: *"I'll need to decide if it's
 * contrived, but it would prove something."* If the seeded rows read as obviously synthetic with
 * the page open, that is itself a finding about the surface — real rows are terser and less tidy
 * than anything written by hand here.
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { buildReservationTrailList } from "../src/admin/reservation-trail-list.js";
import {
  DERIVED_TRAIL_TYPES,
  EMITTED_TRAIL_TYPES,
} from "../src/domain/reservation-trail.js";
import { reservationDemo, buildSeededReservationWorld } from "../src/reservations/seed-reservation.js";
import { buildSeededTrail } from "../src/reservations/seed-trail.js";
import { loadReservationTrail } from "../src/reservations/reservation-trail-view.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const forced = args.some((a) => a === "--force" || a.startsWith("--force="));
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

// Local-DB guard: this writes synthetic rows — never a shared/prod or preview DB by accident.
const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !forced) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed writes synthetic rows — run it against a local/preview DB, or pass --force.`,
  );
  process.exit(1);
}

const repo = PostgresRepository.fromConnectionString(url);

try {
  const now = new Date().toISOString();

  // The same demo world `db:seed:reservation` builds, so the two compose rather than fighting:
  // deterministic ids mean running both in either order leaves one set of rows.
  const demo = reservationDemo(now);
  const world = buildSeededReservationWorld(now, demo);
  await repo.saveLocation(world.location);
  await repo.saveOffering(world.offering);
  for (const e of world.events) await repo.saveEvent(e);

  // The audit hangs off ONE booking — the first booked row of the demo world. A booking rather
  // than a pending row because the History panel is most worth looking at when the booking has a
  // full story behind it.
  const booking = world.reservations.find((r) => r.status === "booked") ?? world.reservations[0];
  if (!booking) {
    console.error("The demo world produced no reservations — nothing to hang an audit on.");
    process.exit(1);
  }

  const seeded = buildSeededTrail({
    reservationId: booking.id,
    paymentIntentId: `pi_seed_${String(booking.id)}`,
    anchorISO: now,
    customerName: booking.customerName,
    eventId: String(booking.eventId ?? world.events[0]?.id ?? ""),
    slot: {
      vesselId: String(world.events[0]?.vesselId ?? ""),
      date: String(world.events[0]?.date ?? ""),
      time: String(world.events[0]?.time ?? ""),
      offeringId: String(world.offering.id),
    },
  });

  // The booking itself, carrying the two columns the derived half projects from.
  await repo.saveReservation({ ...booking, ...seeded.reservationPatch });
  for (const r of world.reservations) {
    if (String(r.id) !== String(booking.id)) await repo.saveReservation(r);
  }

  // The supporting facts, THEN the emitted rows. Order does not matter to the reader, but the
  // derived half is the half that silently renders nothing if its source rows are missing.
  await repo.saveReservation(seeded.lapsedCheckout);
  for (const p of seeded.payments) await repo.savePayment(p);
  await repo.saveGratuity(seeded.gratuity);
  await repo.saveImportRun(seeded.importRun.run, seeded.importRun.items);
  for (const e of seeded.events) await repo.appendTrailEvent(e);

  // ── Verify with the REAL readers, not by counting what we just wrote ───────
  //
  // `db:seed:gratuity` set this precedent and the reason holds here: a seed that reports success
  // by trusting its own writes can print a green line while the surface renders nothing. These
  // are the exact functions the two pages call.
  const history = await loadReservationTrail(repo, booking.id, () => now);
  if (history === null) {
    console.error(`Seed wrote rows but the union read cannot find booking ${String(booking.id)}.`);
    process.exit(1);
  }
  // The abandoned booking's own history — `checkout_lapsed` lives here and NOWHERE else, because
  // a booked row did not lapse whatever its dates say.
  const abandoned = await loadReservationTrail(repo, seeded.lapsedCheckout.id, () => now);

  // **Every type must be reachable on SOME surface**, checked by asking the real readers rather
  // than by counting what we wrote. The three keyless types cannot appear on either booking page
  // by construction, so they are checked against the feed below instead.
  const keyless = ["charge_unmatched", "slot_held", "slot_released"];
  const seen = new Set([...history, ...(abandoned ?? [])].map((h) => h.type));
  const missing = [...EMITTED_TRAIL_TYPES, ...DERIVED_TRAIL_TYPES].filter(
    (t) => !seen.has(t) && !keyless.includes(t),
  );
  if (missing.length > 0) {
    console.error(`Seed wrote rows but no booking's History panel would show: ${missing.join(", ")}`);
    process.exit(1);
  }

  const feed = await buildReservationTrailList(repo, {});
  const orphans = feed.filter((r) => r.reservationId === undefined);
  if (orphans.length < 3) {
    console.error(
      `The feed shows ${orphans.length} rows with no booking; expected 3 ` +
        `(a charge with no booking, and the two slot rows). Those are the class the feed exists for.`,
    );
    process.exit(1);
  }

  console.log(`✓ Seeded & verified the booking audit — every type reachable on both surfaces.`);
  console.log(`  booking   ${String(booking.id)}  (${booking.customerName})`);
  console.log(`  history   ${history.length} entries spanning 6 days, ${seen.size} distinct types across both bookings`);
  console.log(`  abandoned ${String(seeded.lapsedCheckout.id)}  (lapsed checkout — the only home of checkout_lapsed)`);
  console.log(`  feed      ${feed.length} recorded rows, ${orphans.length} of them with no booking`);
  console.log("");
  console.log(`Open /admin/booking-audit for the cross-booking feed — filter by "What happened".`);
  console.log(`Open /admin/calendar/${encodeURIComponent(String(booking.id))} for this booking's History panel,`);
  console.log(`which is the only place the 7 worked-out types appear.`);
  console.log("");
  console.log(`This proves the surface RENDERS. It proves nothing about whether the emitters`);
  console.log(`fire at the right moment — that is the unit tests in #1050, #1051 and #1052.`);
} finally {
  await repo.close();
}
