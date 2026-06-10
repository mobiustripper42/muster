/**
 * Run one engine tick against dev Postgres (DEC-023 — no scheduler in v1, so
 * the clock op is explicit; a hosted cron takes over at first deploy). Dev
 * tooling, not app code: this is how you advance shifts / fire Tier-1 / stall
 * into Tier-2 / record board landings by hand.
 *
 *   npm run db:tick
 *
 * Reads the real clock (the one place outside tests that does — the core
 * itself stays clock-free, `now` is injected here).
 */
import { tick } from "../src/builder/tick.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

try {
  const now = new Date();
  const r = await tick(repo, now);
  console.log(`tick @ ${now.toISOString()}`);
  console.log(`  shiftsAdvanced:  ${r.shiftsAdvanced}`);
  console.log(`  bornFilling:     ${r.bornFilling}`);
  console.log(`  toAtRisk:        ${r.toAtRisk}`);
  console.log(`  asksFired:       ${r.asksFired}   (Tier-1 broadcasts)`);
  console.log(`  shiftsEscalated: ${r.shiftsEscalated}   (Tier-2 stalls worked)`);
  console.log(`  nudgesFired:     ${r.nudgesFired}   (Tier-2 direct nudges)`);
  console.log(`  boardLanded:     ${r.boardLanded}   (new (shift,reason) board landings — DEC-026)`);
} finally {
  await repo.close();
}
