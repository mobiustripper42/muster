/**
 * `db:own` — mark a vessel-day Muster-owned (DEC-106), or list what's owned. The
 * coexistence partition's config mechanism (no admin UI in Phase 11 — its UI is
 * throwaway). Logic lives in the framework-free `src/import/own-cli.ts` (unit-tested);
 * this is the thin DB shell, mirroring db:crew/db:admin.
 *
 *   npm run db:own -- list
 *   npm run db:own -- mark vessel-brew-2 2026-07-04
 *
 * Connects via DATABASE_URL (falling back to local muster_dev). For PROD, point it at
 * the Neon **direct/unpooled** string:
 *   DATABASE_URL="<neon-direct>" npm run db:own -- mark vessel-brew-2 2026-07-04
 * `.env.local` is auto-sourced, but an inline DATABASE_URL wins.
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { OwnCliError, runOwnCommand } from "../src/import/own-cli.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

// Auto-source .env.local (parity with db:crew), but let an inline DATABASE_URL win.
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
  const out = await runOwnCommand(repo, process.argv.slice(2));
  console.log(out);
  console.error(`  (db: ${dbHost(url)})`);
} catch (e) {
  if (!(e instanceof OwnCliError)) throw e; // unexpected → let it surface with a stack
  console.error(e.message);
  console.error(`  (db: ${dbHost(url)})`);
  process.exitCode = 1; // finally still runs (unlike process.exit)
} finally {
  await repo.close();
}
