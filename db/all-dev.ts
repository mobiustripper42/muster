/**
 * `db:all` — the one command that gets a dev database to a known-good state
 * Reset, seed, make the operator an admin, print how to sign in.
 *
 *   npm run db:all              # the whole scenario set
 *   npm run db:all -- --split   # the split/merge fixture, which must run alone
 *
 * ALWAYS DESTRUCTIVE. Every run truncates every table before seeding — there is
 * no incremental mode and no flag to skip it. That is the point: a fresh DB per
 * PR means seeds never have to be idempotent, and state from a previous branch
 * can never leak into the one you are testing.
 *
 * ADDITIVE BY DESIGN. New test data goes in as a new entry in `SEEDS` below —
 * write the scenario as an exported `seedX(repo)` and add one line. The database
 * resets every run; the *registry* only grows. Those aren't in tension: reset
 * wipes rows, the registry accumulates scenarios, and nothing built ever drops
 * out of the set.
 *
 * Dev tooling, not app code.
 */
import { fileURLToPath } from "node:url";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { runAdminCommand } from "../src/admin/admin-cli.js";
import type { Repository } from "../src/ports/repository.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";
import { resetDb } from "./reset-test.js";
import { seedAtRisk } from "./seed-atrisk-dev.js";
import { seedCrewApp, seedOperator } from "./seed-crewapp-dev.js";
import { seedFleetDev } from "./seed-fleet.js";
import { seedOutbox } from "./seed-outbox-dev.js";
import { seedSplit } from "./seed-split-dev.js";

interface Seed {
  name: string;
  run: (repo: Repository) => Promise<void>;
}

/**
 * The scenario set, in dependency order. Fleet first — it materializes the
 * vessels and role types every later seed resolves against.
 *
 * ADD NEW TEST DATA HERE. One line per scenario, appended at the end unless it
 * has a real ordering dependency.
 */
const SEEDS: Seed[] = [
  { name: "fleet", run: seedFleetDev },
  { name: "crewapp", run: seedCrewApp },
  { name: "atrisk", run: seedAtRisk },
  { name: "outbox", run: seedOutbox },
];

/**
 * `--split` runs INSTEAD of the set above, not alongside it. seed-split-dev
 * builds its shift through `formShifts` with canonical ids; the scenario seeds
 * hand-author non-canonical ones (`shift-ar-gappy`, …), and `formShifts` is
 * global — so splitting anything with both loaded duplicates every scenario
 * shift ("two rows, same times"). See the warning at the top of
 * db/seed-split-dev.ts. Consolidating the seeds behind `formShifts` would
 * dissolve this split; until then the modes stay mutually exclusive.
 */
const SPLIT_SEEDS: Seed[] = [
  { name: "fleet", run: seedFleetDev },
  { name: "split", run: seedSplit },
];

/** The operator's dev identity. The crew record is seeded by `crewapp`; this
 *  promotes it to admin (DEC-092 — admins are CLI-managed, never seeded, and an
 *  admin id must be a real crew id). Email lives on the crew record and is the
 *  sign-in identity: login matches on email only. */
const ADMIN_CREW_ID = "crew-eric";
const ADMIN_HANDLE = "eric";
const ADMIN_EMAIL = "eric@bb.test";

/** Local-only guard. This truncates every table, so a `DATABASE_URL` pointing at
 *  Neon would wipe an environment nobody meant to touch. Host must be loopback;
 *  there is deliberately no `--force`. To reset a remote DB, do it deliberately
 *  with the individual commands. */
function assertLocal(connectionString: string): void {
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    throw new Error(`db:all: could not parse DATABASE_URL — refusing to truncate.`);
  }
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error(
      `db:all: DATABASE_URL points at "${host}", not localhost. This command TRUNCATES ` +
        `every table — refusing. Run the individual db:migrate / db:seed:* commands if ` +
        `you really mean to touch a remote database.`,
    );
  }
}

export async function runAll(connectionString: string, split: boolean): Promise<void> {
  assertLocal(connectionString);
  const seeds = split ? SPLIT_SEEDS : SEEDS;

  console.log(`db:all → ${new URL(connectionString).host}${new URL(connectionString).pathname}`);
  console.log("Resetting (migrate + truncate every table)…");
  await resetDb(connectionString);

  const repo = PostgresRepository.fromConnectionString(connectionString);
  try {
    for (const seed of seeds) {
      console.log(`\n── ${seed.name} ──────────────────────────────`);
      await seed.run(repo);
    }

    // Admin last, and in EVERY mode. The crew record must exist first (the CLI
    // validates that an admin id is a real crew id, DEC-092); `seedOperator` is
    // idempotent, so calling it here is a no-op when `crewapp` already ran. The
    // truncate above emptied `admins`, so `add` can't collide with a stale row.
    console.log("\n── admin ──────────────────────────────");
    await seedOperator(repo);
    console.log(
      await runAdminCommand(
        repo,
        ["add", `--crew=${ADMIN_CREW_ID}`, `--handle=${ADMIN_HANDLE}`],
        new Date(),
      ),
    );
    console.log(`\nSign in: http://localhost:3000/crew → enter ${ADMIN_EMAIL}`);
    console.log("The login code prints in THIS dev server's terminal ([login-code] →).");
  } finally {
    await repo.close();
  }
}

// CLI entry: `npm run db:all [-- --split]`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const split = process.argv.includes("--split");
  try {
    await runAll(url, split);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
