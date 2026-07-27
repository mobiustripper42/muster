/**
 * `db:seed:gratuity` — put a splittable, booked gratuity in front of the Gusto tip report
 * (12.3b) so `/admin/payroll` → Tips (Gusto) + Download Gusto CSV actually render.
 *
 * It builds a COMPLETE self-contained crewed trip dated inside the CURRENT pay period (vessel →
 * Crewed shift + Confirmed seats for real crew → event → booked reservation → pre gratuity),
 * then VERIFIES the tip splits by running the real `buildGratuityPayroll` — so it can never
 * print a false success the way the first version did (it used to grab any existing shift,
 * including future at-risk trips the payroll won't credit).
 *
 *     npm run db:seed:gratuity                 # $60 tip, split among 2 active crew, today
 *     npm run db:seed:gratuity --amount=12000  # $120
 *
 * Flags:
 *   --amount=<cents>   gratuity to collect (default 6000 = $60.00)
 *   --bps=<int>        tier basis points, provenance only (default 2000 = 20%)
 *   --force            bypass the local-DB guard (writes synthetic rows)
 *
 * Idempotent: deterministic ids keyed on today's date ⇒ re-running upserts, never double-counts.
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { buildGratuityPayroll, gustoTipsCsv } from "../src/admin/gratuity-payroll.js";
import { currentPeriod } from "../src/admin/pay-periods.js";
import { PAY_PERIOD_ANCHOR, vesselDateOf } from "../src/config/tenant.js";
import { buildSeededGratuity } from "../src/reservations/seed-gratuity.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
};

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

// Local-DB guard: this writes synthetic rows — never a shared/prod or preview DB by accident.
const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && flag("force") === undefined) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed writes synthetic rows — run it against a local/preview DB, or pass --force.`,
  );
  process.exit(1);
}

const amountCents = Number(flag("amount") ?? 6000);
if (!Number.isInteger(amountCents) || amountCents <= 0) {
  console.error(`--amount must be a positive integer of cents (got ${flag("amount")}).`);
  process.exit(1);
}
const bpsRaw = flag("bps");
const bps = bpsRaw === undefined ? 2000 : Number(bpsRaw);
if (!Number.isInteger(bps) || bps < 0) {
  console.error(`--bps must be a non-negative integer (got ${bpsRaw}).`);
  process.exit(1);
}

const repo = PostgresRepository.fromConnectionString(url);

try {
  // Split among up to 2 real, active crew — so the payroll shows familiar (loginable) names.
  const crew = (await repo.listCrewMembers()).filter((c) => c.status === "active").slice(0, 2);
  if (crew.length === 0) {
    console.error("No active crew found. Seed crew first (e.g. npm run db:seed:crew), then re-run.");
    process.exit(1);
  }

  // Ensure the tipped crew are Gusto-mapped so the CSV actually imports. The test roster is
  // fictional, so the extractor's real-name map never covers them — give any unmapped one a
  // deterministic fake identity. Real, already-mapped crew are left alone.
  for (const c of crew) {
    if (c.gusto) continue;
    const [first, ...rest] = c.name.split(/\s+/);
    await repo.updateCrewGusto(c.id, {
      firstName: first ?? c.name,
      lastName: rest.join(" ") || "Test",
      title: c.ratings[0] ? String(c.ratings[0]).replace(/^role-/, "") : "crew",
      employeeId: `seed-${String(c.id).replace(/^crew-/, "").slice(0, 12)}`,
    });
  }

  const today = vesselDateOf(new Date());
  const world = buildSeededGratuity({
    crew: crew.map((c) => ({ id: String(c.id), role: c.ratings[0] ? String(c.ratings[0]) : undefined })),
    date: today,
    amountCents,
    bps,
    createdAt: new Date().toISOString(),
  });

  await repo.saveVessel(world.vessel);
  await repo.saveEvent(world.event);
  await repo.saveShift(world.shift);
  for (const s of world.seats) await repo.saveSeat(s);
  await repo.saveReservation(world.reservation);
  await repo.saveGratuity(world.gratuity);

  // VERIFY against the real report before claiming anything — the whole point of the rewrite.
  const period = currentPeriod(PAY_PERIOD_ANCHOR, today);
  const report = await buildGratuityPayroll(repo, { from: period.start, to: period.end });
  const seededCrew = new Set(crew.map((c) => String(c.id)));
  const split = report.rows.filter((r) => seededCrew.has(r.crewMemberId));
  const splitTotal = split.reduce((n, r) => n + r.tipCents, 0);

  if (split.length === 0 || splitTotal < amountCents) {
    console.error("Seed wrote rows but the payroll did NOT split them — something's off:");
    for (const w of report.warnings) console.error(`  ! ${w}`);
    console.error(`  expected ${amountCents}¢ across ${crew.length} crew in ${period.start}..${period.end}, got ${splitTotal}¢.`);
    process.exit(1);
  }

  // Verify the CSV isn't empty either — the whole point is an importable file.
  const csv = gustoTipsCsv(split);
  const csvRows = csv.trim().split("\n").length - 1; // minus the header row
  if (csvRows < split.length) {
    console.error(`Split OK but the CSV has ${csvRows} importable rows for ${split.length} tipped crew — Gusto ids missing.`);
    process.exit(1);
  }

  const dollars = (amountCents / 100).toFixed(2);
  const names = crew.map((c) => c.name).join(", ");
  console.log(`✓ Seeded & verified a $${dollars} pre-trip gratuity (${bps} bps) — split + CSV both non-empty.`);
  console.log(`  trip     ${world.shift.id}  (${today})`);
  console.log(`  splits among ${crew.length}: ${names}  →  ${split.map((r) => `$${(r.tipCents / 100).toFixed(2)}`).join(", ")}`);
  console.log("");
  console.log(`Open /admin/payroll and pick the pay period containing ${today} → Tips (Gusto)`);
  console.log(`shows the split, and Download Gusto CSV gives an importable file.`);
} finally {
  await repo.close();
}
