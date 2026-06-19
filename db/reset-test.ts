/**
 * Clean-slate helper for the e2e harness (#65). The dev seeds upsert and never
 * delete (RUNNING.md), so re-running a seed can't undo contamination — only a
 * truncate gets crew-only vs both-seeds states deterministic. This is the
 * scripted equivalent of `docker compose down -v`, scoped to `muster_test` so it
 * never touches dev data.
 *
 * Used by `e2e/fixtures.ts` (beforeEach reset+seed) and the `db:reset:test` CLI.
 */
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "./migrate.js";

/** The throwaway test DB the harness drives. Overridable for CI. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://muster:muster@localhost:5432/muster_test";

/**
 * Ensure the schema exists (migrate is idempotent — a no-op once applied, and it
 * picks up any new migration automatically), then truncate every app table so
 * the next seed starts from nothing. `_migrations` is preserved.
 */
export async function resetTestDb(
  connectionString: string = TEST_DATABASE_URL,
): Promise<void> {
  await migrate(connectionString);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and tablename <> '_migrations'`,
    );
    if (rows.length === 0) return;
    const list = rows.map((r) => `"${r.tablename}"`).join(", ");
    // No-FK schema (DEC-DATA), so CASCADE has nothing to chase — kept for safety.
    await client.query(`truncate ${list} restart identity cascade`);
  } finally {
    await client.end();
  }
}

// CLI entry: `tsx db/reset-test.ts`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  resetTestDb()
    .then(() => console.log("Test DB reset (schema migrated, tables truncated)."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
