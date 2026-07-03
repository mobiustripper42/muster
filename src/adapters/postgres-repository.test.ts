/**
 * Postgres adapter — runs the shared Repository contract (DEC-020) against real
 * Postgres. **Skips cleanly when no test DB is reachable** (same posture as the
 * import smoke test that skips if the real file is absent), so `npm run test` /
 * `verify` stay Docker-free; `npm run test:pg` (with `docker compose up -d`)
 * exercises it. Migrates the test DB once, truncates before each test.
 */
import pg from "pg";
import { afterAll, describe, it } from "vitest";
import { migrate } from "../../db/migrate.js";
import { PostgresRepository } from "./postgres-repository.js";
import { runRepositoryContract } from "./repository-contract.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://muster:muster@localhost:5432/muster_test";

const TABLES = [
  "role_types",
  "vessels",
  "crew_members",
  "credentials",
  "pto_windows",
  "events",
  "reservations",
  "shifts",
  "seats",
  "asks",
  "magic_tokens",
  "login_codes",
  "outbox_entries",
  "ring_outbox",
  "reliability_events",
  "sms_consent",
  "app_settings",
  "import_runs",
  "import_run_items",
  "threads",
  "thread_participants",
  "messages",
  "message_reads",
  "doorbell_notifications",
];

async function canConnect(url: string): Promise<boolean> {
  // Short timeout so a down DB skips fast instead of hanging the suite.
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

// Top-level probe so the suite can register skipped when Docker/Postgres is down.
const dbUp = await canConnect(TEST_URL);

if (!dbUp) {
  describe.skip("Repository contract — postgres (no TEST DB reachable)", () => {
    it("skipped — run `docker compose up -d` then `npm run test:pg`", () => {});
  });
} else {
  const pool = new pg.Pool({ connectionString: TEST_URL });
  await migrate(TEST_URL);

  runRepositoryContract("postgres", async () => {
    await pool.query(
      `truncate ${TABLES.join(", ")} restart identity cascade`,
    );
    return new PostgresRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });
}
