/**
 * Postgres PresencePort adapter — runs the shared contract (#112) against real
 * Postgres. **Skips cleanly when no test DB is reachable** (same posture as the
 * Repository contract), so `npm run test` / `verify` stay Docker-free; `npm run
 * test:pg` (with `docker compose up -d`) exercises it. Migrates once, truncates
 * `presence` before each test.
 *
 * **Its own database, not the shared `muster_test` (#1041).** This suite owns the
 * `presence` table, and vitest runs test files in parallel — so while it shared a database
 * with the Repository contract, that suite's per-test truncate could wipe rows this one was
 * mid-way through asserting on. It did not, for a while, only because the contract's
 * truncate list had missed `presence` by accident; fixing that list (#1031) turned the
 * accident into a flake. Isolation by ownership rather than by a skip list somebody has to
 * keep correct.
 */
import pg from "pg";
import { afterAll, describe, it } from "vitest";
import { migrate } from "../../db/migrate.js";
import { PostgresPresence } from "./postgres-presence.js";
import { runPresenceContract } from "./presence-contract.js";
import { ensureTestDatabase } from "./test-database.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://muster:muster@localhost:5432/muster_test";

async function canConnect(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

// Probe the SHARED url — it is the one docker-compose and CI create, so its reachability
// is what "is Postgres up" means. The suite's own database is made from it below.
const dbUp = await canConnect(TEST_URL);

if (!dbUp) {
  describe.skip("PresencePort contract — postgres (no TEST DB reachable)", () => {
    // Inside `describe.skip`, so it NEVER RUNS — it exists to print the command that
    // makes the suite runnable. An assertion here would assert nothing, later (#908).
    // eslint-disable-next-line sonarjs/assertions-in-tests, vitest/expect-expect -- never runs
    it("skipped — run `docker compose up -d` then `npm run test:pg`", () => {});
  });
} else {
  const url = await ensureTestDatabase(TEST_URL, "presence");
  const pool = new pg.Pool({ connectionString: url });
  await migrate(url);

  runPresenceContract("postgres", async () => {
    await pool.query("truncate presence restart identity cascade");
    return new PostgresPresence(pool);
  });

  afterAll(async () => {
    await pool.end();
  });
}
