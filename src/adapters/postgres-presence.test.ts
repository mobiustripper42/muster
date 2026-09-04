/**
 * Postgres PresencePort adapter — runs the shared contract (#112) against real
 * Postgres. **Skips cleanly when no test DB is reachable** (same posture as the
 * Repository contract), so `npm run test` / `verify` stay Docker-free; `npm run
 * test:pg` (with `docker compose up -d`) exercises it. Migrates once, truncates
 * `presence` before each test.
 */
import pg from "pg";
import { afterAll, describe, it } from "vitest";
import { migrate } from "../../db/migrate.js";
import { PostgresPresence } from "./postgres-presence.js";
import { runPresenceContract } from "./presence-contract.js";

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

const dbUp = await canConnect(TEST_URL);

if (!dbUp) {
  describe.skip("PresencePort contract — postgres (no TEST DB reachable)", () => {
    // Inside `describe.skip`, so it NEVER RUNS — it exists to print the command that
    // makes the suite runnable. An assertion here would assert nothing, later (#908).
    // eslint-disable-next-line sonarjs/assertions-in-tests, vitest/expect-expect -- never runs
    it("skipped — run `docker compose up -d` then `npm run test:pg`", () => {});
  });
} else {
  const pool = new pg.Pool({ connectionString: TEST_URL });
  await migrate(TEST_URL);

  runPresenceContract("postgres", async () => {
    await pool.query("truncate presence restart identity cascade");
    return new PostgresPresence(pool);
  });

  afterAll(async () => {
    await pool.end();
  });
}
