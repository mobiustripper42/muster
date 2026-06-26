/**
 * Pilot data reset — clear the operational slate, keep the reference data.
 *
 * Operator-requested (#147 fallout): wipe shifts + everything derived from them
 * so the pilot can re-import clean from Xola and re-test the engine fixes,
 * WITHOUT re-seeding vessels and crew by hand. Distinct from `reset-test.ts`,
 * which truncates *every* table against the throwaway test DB; this one runs
 * against a real (prod) DB and truncates an **explicit, classified** subset.
 *
 * **Destructive + prod-targeted, so it is guarded four ways:**
 *  1. `DATABASE_URL` MUST be set — no fallback (unlike reset-test's safe local
 *     default). An unset URL aborts rather than drifting to libpq defaults.
 *  2. Every table in `pg_tables` must be classified KEEP or CLEAR here. A new
 *     migration's table that nobody classified aborts the run — so a future
 *     table can never be silently kept *or* silently wiped.
 *  3. It is a **dry run by default**: it prints the connected DB + keep/clear
 *     lists + a live row count per table, then stops. It only deletes when
 *     `RESET_PILOT_CONFIRM=yes` is set — a deliberate second action.
 *  4. **Target identity is enforced, not echoed**: execute also requires
 *     `RESET_PILOT_EXPECT_DB` to equal the server's `current_database()`, so a
 *     wrong-but-same-schema URL (muster_dev, another tenant) can't slip through
 *     on the confirm token alone. The dry run prints the exact value to set.
 *
 * Run (dry run — shows the blast radius + the DB name to confirm, touches nothing):
 *   DATABASE_URL='<prod-direct-unpooled-url>' npx tsx db/reset-pilot.ts
 * Run (execute):
 *   DATABASE_URL='<prod-direct-unpooled-url>' RESET_PILOT_CONFIRM=yes \
 *     RESET_PILOT_EXPECT_DB='<the-db-name-the-dry-run-printed>' npx tsx db/reset-pilot.ts
 *
 * After it runs: re-import from Xola (operator "Pull from Xola now", or the
 * hourly cron) to repopulate events → re-form shifts with the fixed engine.
 */
import { fileURLToPath } from "node:url";
import pg from "pg";

/** Reference data the reset preserves — vessels, crew, and their attributes. */
const KEEP = new Set<string>([
  "vessels",
  "role_types",
  "crew_members",
  "credentials",
  "pto_windows",
  "app_settings", // engine-pause flag + tenant config — not operator state to wipe
  "magic_tokens", // active crew/admin sign-in links — clearing logs everyone out
]);

/**
 * Operational state the reset wipes — shifts + assignments + everything that
 * hangs off a shift. Order is irrelevant (no-FK schema, DEC-DATA), but the list
 * is explicit so a review can see exactly what dies.
 */
const CLEAR: readonly string[] = [
  "shifts",
  "seats", // assignments live here (assignedCrewMemberId + state)
  "asks",
  "outbox_entries",
  "events", // the Xola trips shifts form from — wiped for a clean re-import
  "reservations",
  "import_runs",
  "import_run_items",
  "reliability_events", // crew history references the deleted shifts → fresh scores
  "threads", // Phase 6 messaging substrate (likely empty in prod) — clean slate
  "thread_participants",
  "messages",
  "presence",
];

/** Host (no credentials) for the "are you sure you're hitting prod?" echo. */
function hostOf(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    return `${u.host}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

export async function resetPilot(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required (no fallback). Set it to the target DB's direct URL.",
    );
  }
  const confirmed = process.env.RESET_PILOT_CONFIRM === "yes";

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // Authoritative connected-DB name (from the server, not the URL parse) — the
    // target-identity guard and the plan echo both key off this.
    const { rows: dbRows } = await client.query<{ db: string }>(
      `select current_database() as db`,
    );
    const currentDb = dbRows[0]!.db;

    // Classification guard: every real table must be KEEP or CLEAR (or the
    // migrations ledger). An unclassified table aborts — never silently handled.
    const { rows } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    );
    const clearSet = new Set(CLEAR);
    const unknown = rows
      .map((r) => r.tablename)
      .filter((t) => t !== "_migrations" && !KEEP.has(t) && !clearSet.has(t));
    if (unknown.length > 0) {
      throw new Error(
        `Unclassified table(s): ${unknown.join(", ")}. Add each to KEEP or CLEAR ` +
          `in db/reset-pilot.ts before running — refusing to guess.`,
      );
    }

    // Only touch CLEAR tables that actually EXIST. A prod DB missing a migration
    // (e.g. 0009 `presence` was never applied) shouldn't crash the reset — there's
    // nothing to clear in a table that isn't there. Absent tables are reported and
    // skipped, never counted or truncated.
    const existing = new Set(rows.map((r) => r.tablename));
    const clearPresent = CLEAR.filter((t) => existing.has(t));
    const clearAbsent = CLEAR.filter((t) => !existing.has(t));

    // Row counts for the blast-radius echo (cheap on pilot-scale tables).
    const counts: Record<string, number> = {};
    for (const t of clearPresent) {
      const { rows: c } = await client.query<{ n: string }>(
        `select count(*)::text as n from "${t}"`,
      );
      counts[t] = Number(c[0]!.n);
    }

    console.log(
      `\nPilot reset — connected to DB "${currentDb}" at ${hostOf(connectionString)}`,
    );
    console.log(`KEEP (untouched): ${[...KEEP].join(", ")}`);
    console.log("CLEAR:");
    for (const t of clearPresent) console.log(`  ${t.padEnd(20)} ${counts[t]} rows`);
    for (const t of clearAbsent)
      console.log(`  ${t.padEnd(20)} (absent — migration not applied, skipped)`);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    if (!confirmed) {
      console.log(
        `\nDRY RUN — nothing deleted (${total} rows would be cleared).` +
          `\nTo execute: RESET_PILOT_CONFIRM=yes RESET_PILOT_EXPECT_DB="${currentDb}"\n`,
      );
      return;
    }

    // Target-identity guard: the confirm token proves intent, but NOT that this is
    // the intended DB. A wrong-but-same-schema URL (muster_dev, another tenant)
    // passes every other guard. Require the operator to name the DB they mean and
    // assert it against the server's own `current_database()` — an enforced second
    // look, not a fire-and-forget host echo.
    const expectDb = process.env.RESET_PILOT_EXPECT_DB;
    if (expectDb !== currentDb) {
      throw new Error(
        `Target-identity mismatch: connected to "${currentDb}" but ` +
          `RESET_PILOT_EXPECT_DB=${expectDb ?? "(unset)"}. ` +
          `Set RESET_PILOT_EXPECT_DB="${currentDb}" to confirm THIS is the DB to wipe.`,
      );
    }

    const list = clearPresent.map((t) => `"${t}"`).join(", ");
    await client.query(`truncate ${list} restart identity cascade`);
    console.log(
      `\nDONE — cleared ${total} rows across ${clearPresent.length} tables` +
        (clearAbsent.length ? ` (${clearAbsent.length} absent, skipped)` : "") +
        `. Re-import from Xola to repopulate.\n`,
    );
  } finally {
    await client.end();
  }
}

// CLI entry: `tsx db/reset-pilot.ts`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  resetPilot().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
