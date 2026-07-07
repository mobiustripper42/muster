/**
 * `db:crew` — fix a crew member's contact info (phone/email) on a live DB
 * (Phase 10.5 break-glass). The launch lever for the two most likely pilot
 * fires: a wrong phone (no SMS) or a wrong email (login code never matches).
 * Logic lives in the framework-free `src/crew/crew-cli.ts` (unit-tested); this
 * is the thin DB shell.
 *
 *   npm run db:crew -- list
 *   npm run db:crew -- set crew-eric --email=eric@stoffer.net
 *   npm run db:crew -- set crew-eric --phone=+15035550123 --name="Eric Stoffer"
 *
 * Connects via DATABASE_URL — same as db:migrate/db:mint/db:admin — falling back
 * to local muster_dev. For PROD, point it at the Neon **direct/unpooled** string:
 *   DATABASE_URL="<neon-direct>" npm run db:crew -- set crew-eric --email=…
 * `.env.local` is auto-sourced like db:mint, but an inline DATABASE_URL wins.
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { CrewCliError, runCrewCommand } from "../src/crew/crew-cli.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

// Auto-source .env.local (parity with db:mint), but let an inline DATABASE_URL win.
if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

/** host:port a connection targets — so the operator SEES which DB they mutated. */
function dbHost(connectionString: string): string {
  try {
    return new URL(connectionString).host || "(unknown)";
  } catch {
    return "(unparseable)";
  }
}

// `||` not `??`: an empty DATABASE_URL (what Neon's Sensitive vars pull as) is
// "unset", not a valid string — fall to local rather than hand pg a "".
const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

try {
  const out = await runCrewCommand(repo, process.argv.slice(2));
  console.log(out);
  console.error(`  (db: ${dbHost(url)})`);
} catch (e) {
  if (!(e instanceof CrewCliError)) throw e; // unexpected → let it surface with a stack
  console.error(e.message);
  console.error(`  (db: ${dbHost(url)})`);
  process.exitCode = 1; // finally still runs (unlike process.exit)
} finally {
  await repo.close();
}
