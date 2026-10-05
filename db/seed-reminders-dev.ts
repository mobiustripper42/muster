/**
 * `db:seed:reminders` — a party still signing, seven days out, so a waiver reminder (Phase 18.7,
 * issue #1121) can be watched going out from a hand-run cron tick.
 *
 * Writes, on the first boat in the database (run `db:seed:crew` or `db:reset:dev` first):
 *
 * - a waiver version in effect from today, if none is — reminders send nothing without one;
 * - a departure seven days from today, boat time, at 10:15 (an hour no other seed uses);
 * - **Amy Nowak's** booking on it, a party of 4 with one adult signed — the one to be reminded;
 * - **Bea Ruiz's** booking on it, a party of 2, both signed — the one who must NOT be.
 *
 * **Re-running resets it**: Amy's reminder windows for that trip are given back, so the tick reminds
 * her again. That is the hand test's reset.
 *
 * **Whose phone.** Amy's phone defaults to a fictional 555 number. `.env.local` may carry live Twilio
 * keys, and a live send to a fictional number fails at the carrier — the trail then says so. To get
 * the text on a real phone, set `SEED_REMINDER_PHONE=+1…` (and `SEED_REMINDER_EMAIL` for the email,
 * which is otherwise left off so a live Resend key is not spent on an undeliverable address).
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { addDays, vesselDateOf, zonedWallClockToInstant } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const forced = args.some((a) => a === "--force" || a.startsWith("--force="));
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

const repo = PostgresRepository.fromConnectionString(url);

try {
  const now = new Date();
  const nowIso = now.toISOString();
  const today = vesselDateOf(now);
  const tripDate = addDays(today, 7);

  const vessel = (await repo.listVessels())[0];
  const admin = (await repo.listAdmins()).find((a) => a.active);
  if (!vessel || !admin) {
    console.error("No boat or no active admin in this database — run `npm run db:seed:crew` first.");
    process.exit(1);
  }

  if (!(await repo.getCurrentWaiverTemplate(nowIso))) {
    // Midnight at the start of today, boat time — how /admin/waivers dates a version posted today.
    const effectiveFrom = zonedWallClockToInstant(today, "00:00").toISOString();
    const posted = await repo.postWaiverTemplate({
      id: asId<"WaiverTemplateId">("wt-seed-reminders"),
      version: "seed-reminders-v1",
      body: "I understand the risks of being on the water, and I accept them.",
      effectiveFrom,
      postedAt: nowIso,
      postedBy: String(admin.id),
    });
    // One version per instant (issue #1137) — say so rather than fail on the line below.
    if (posted === "date_taken") {
      console.error(`Another waiver version already takes effect at ${effectiveFrom} — remove it or reset the database.`);
      process.exit(1);
    }
  }
  const waiver = (await repo.getCurrentWaiverTemplate(nowIso))!;

  const eventId = asId<"EventId">("evt-seed-reminder-7d");
  await repo.saveEvent({
    id: eventId,
    vesselId: vessel.id,
    date: tripDate,
    time: "10:15",
    capacity: vessel.coiMaxPax,
    status: "scheduled",
    source: "muster",
  });

  const amy = asId<"ReservationId">("resv-seed-reminder-amy");
  const bea = asId<"ReservationId">("resv-seed-reminder-bea");
  await repo.saveReservation({
    id: amy,
    eventId,
    customerName: "Amy Nowak",
    partySize: 4,
    phone: process.env.SEED_REMINDER_PHONE || "+12165550142",
    ...(process.env.SEED_REMINDER_EMAIL ? { email: process.env.SEED_REMINDER_EMAIL } : {}),
    status: "booked",
    source: "muster",
  });
  await repo.saveReservation({
    id: bea,
    eventId,
    customerName: "Bea Ruiz",
    partySize: 2,
    phone: "+12165550143",
    status: "booked",
    source: "muster",
  });

  const signed = (id: string, name: string, reservationId: typeof amy) => ({
    id: asId<"GuestId">(id),
    eventId,
    reservationId,
    name,
    email: `${id}@example.com`,
    dob: "1985-05-05",
    isMinor: false,
    signedAt: nowIso,
    waiverTemplateId: waiver.id,
    signatureName: name,
    source: "self" as const,
    createdAt: nowIso,
  });
  // Insert-only per id, so a re-run leaves these as they are.
  await repo.saveGuests([signed("g-seed-reminder-amy", "Amy Nowak", amy)]);
  await repo.saveGuests([signed("g-seed-reminder-bea", "Bea Ruiz", bea)]);
  await repo.saveGuests([signed("g-seed-reminder-luis", "Luis Ruiz", bea)]);

  // The reset: give back every reminder window Amy has used for this trip, so the tick sends again.
  for (const r of await repo.listWaiverRemindersForReservation(amy)) {
    if (r.tripDate === tripDate) await repo.releaseWaiverReminder(amy, r.tripDate, r.daysBefore);
  }

  const config = await repo.getCheckInConfig();
  console.log(`✓ Seeded a party still signing, seven days out.`);
  console.log(`  trip      ${tripDate} 10:15 on ${vessel.name} (${String(eventId)})`);
  console.log(`  remind    Amy Nowak  ${String(amy)}  1 of 4 signed  phone ${process.env.SEED_REMINDER_PHONE ? "(yours)" : "+12165550142 (fictional)"}`);
  console.log(`  skip      Bea Ruiz   ${String(bea)}  2 of 2 signed`);
  console.log(`  reminder days: ${config.reminderDaysBefore.join(", ") || "(none — reminders are off)"}`);
  if (!config.reminderDaysBefore.includes(7)) {
    console.log(`  ⚠ 7 is not a reminder day in /admin/waivers, so the tick will send nothing.`);
  }
} finally {
  await repo.close();
}
