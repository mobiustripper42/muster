/**
 * Postgres adapter — runs the shared Repository contract (DEC-020) against real
 * Postgres. **Skips cleanly when no test DB is reachable** (same posture as the
 * import smoke test that skips if the real file is absent), so `npm run test` /
 * `verify` stay Docker-free; `npm run test:pg` (with `docker compose up -d`)
 * exercises it. Migrates the test DB once, truncates before each test.
 */
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "../../db/migrate.js";
import { PostgresRepository } from "./postgres-repository.js";
import { runRepositoryContract } from "./repository-contract.js";
import { clockIn } from "../crew/time-clock.js";
import { asId } from "../domain/ids.js";
import type { TimePunch } from "../domain/entities.js";
import type { CrewMemberId, TimePunchId } from "../domain/ids.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://muster:muster@localhost:5432/muster_test";

const TABLES = [
  "role_types",
  "vessels",
  "crew_members",
  "credentials",
  "pto_windows",
  "time_punches",
  "time_punch_edits",
  "events",
  "reservations",
  "offerings",
  "locations",
  "add_ons",
  "customers",
  "blocks",
  "checkout_holds",
  "gratuity",
  "muster_owned_vessel_days",
  "payments",
  "shifts",
  "seats",
  "asks",
  "magic_tokens",
  "admins",
  "login_codes",
  "calendar_feeds",
  "outbox_entries",
  "ring_outbox",
  "notice_outbox",
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

  /**
   * The one-open-punch invariant (SPEC §2.9.4) lives in the DATABASE — a partial
   * unique index — so this is the only place it can be proven. The in-memory double
   * deliberately doesn't enforce constraints (DEC-131), which is exactly why the
   * contract suite can't cover this and why it gets its own describe here.
   */
  describe("time punches — the one-open-punch index (§2.9.4)", () => {
    const CREW = asId<"CrewMemberId">("crew-a");
    const openPunch = (id: string): TimePunch => ({
      id: asId<"TimePunchId">(id),
      crewMemberId: CREW,
      inAt: "2026-07-15T13:00:00.000Z",
      outAt: null,
      shiftId: null,
      origin: "crew",
      adminEditedAt: null,
    });

    async function freshRepo(): Promise<PostgresRepository> {
      await pool.query(`truncate ${TABLES.join(", ")} restart identity cascade`);
      const repo = new PostgresRepository(pool);
      await repo.saveCrewMember({
        id: CREW,
        name: "Quint",
        phone: "555",
        ratings: [],
        status: "active",
        reliabilityScore: null,
      });
      return repo;
    }

    it("a second OPEN punch for the same crew member is refused by the database", async () => {
      const repo = await freshRepo();
      await repo.saveTimePunch(openPunch("punch-1"));

      await expect(repo.saveTimePunch(openPunch("punch-2"))).rejects.toMatchObject({
        code: "23505",
      });
      const rows = await repo.listTimePunchesForCrew(CREW);
      expect(rows).toHaveLength(1);
    });

    it("two concurrent clockIns produce ONE punch and an already_in — not a 500", async () => {
      // The race the index exists for: both calls read "nothing open" before either
      // writes, so the application-level check in `clockIn` passes twice and only
      // the constraint stops the second row. The loser must come back as the same
      // calm `already_in` a sequential double-tap gets.
      const repo = await freshRepo();
      const at = new Date("2026-07-15T13:00:00.000Z");

      const [a, b] = await Promise.all([
        clockIn(repo, { id: asId<"TimePunchId">("punch-a"), crewMemberId: CREW, at }),
        clockIn(repo, { id: asId<"TimePunchId">("punch-b"), crewMemberId: CREW, at }),
      ]);

      const outcomes = [a, b];
      expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
      expect(outcomes.filter((r) => !r.ok && r.code === "already_in")).toHaveLength(1);
      expect(await repo.listTimePunchesForCrew(CREW)).toHaveLength(1);
    });

    it("closing a punch frees the slot — the index constrains OPEN rows only", async () => {
      const repo = await freshRepo();
      await repo.saveTimePunch(openPunch("punch-1"));
      await repo.saveTimePunch({
        ...openPunch("punch-1"),
        outAt: "2026-07-15T21:00:00.000Z",
      });

      await repo.saveTimePunch(openPunch("punch-2"));
      expect(await repo.listTimePunchesForCrew(CREW)).toHaveLength(2);
      expect(await repo.getOpenPunchForCrew(CREW)).toMatchObject({ id: "punch-2" });
    });

    it("a crew member with punches cannot be deleted out from under them", async () => {
      // `on delete restrict`: hours already worked are still owed, so this must
      // fail loudly rather than cascade a paycheck into the void.
      const repo = await freshRepo();
      await repo.saveTimePunch(openPunch("punch-1"));

      await expect(
        pool.query("delete from crew_members where id=$1", [CREW]),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });
}
