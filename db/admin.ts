/**
 * `db:admin` — manage the `admins` table (DEC-092) against a live DB. The launch
 * interface for adding/removing admins (no UI at ~3 admins). Logic lives in the
 * framework-free `src/admin/admin-cli.ts` (unit-tested); this is the thin DB shell.
 *
 *   npm run db:admin -- list
 *   npm run db:admin -- add --email=eric@stoffer.net --handle=eric
 *   npm run db:admin -- add --crew=crew-eric --handle=eric --name="Eric Stoffer"
 *   npm run db:admin -- revoke <handle>
 *   npm run db:admin -- reactivate <handle>
 *
 * Connects via DATABASE_URL — same as db:migrate/db:mint — falling back to local
 * muster_dev. For PROD, point it at the Neon **direct/unpooled** string:
 *   DATABASE_URL="<neon-direct>" npm run db:admin -- add --email=… --handle=…
 * (or reuse a `mint-prod`-style alias — see docs/DEPLOY.md). `.env.local` is
 * auto-sourced like db:mint, but an inline DATABASE_URL always wins.
 *
 * Reads the real clock (the core stays clock-free — `now` injected).
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { AdminCliError, runAdminCommand } from "../src/admin/admin-cli.js";
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
  const out = await runAdminCommand(repo, process.argv.slice(2), new Date());
  console.log(out);
  console.error(`  (db: ${dbHost(url)})`);
} catch (e) {
  if (!(e instanceof AdminCliError)) throw e; // unexpected → let it surface with a stack
  console.error(e.message);
  console.error(`  (db: ${dbHost(url)})`);
  process.exitCode = 1; // finally still runs (unlike process.exit)
} finally {
  await repo.close();
}
