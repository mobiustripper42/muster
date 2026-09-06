/**
 * `db:reset:dev` — rebuild the DEV database from migrations + seeds.
 *
 * **Why this exists.** The dev seeds overwhelmingly upsert, so re-running one can't undo
 * anything: rows accumulate across every era of the model the project has passed through. A
 * booking hand-materialized by an 11.2-era harness still sits there after 12.0 changed what a
 * booking *is*, and it reads as a bug on a surface written months later. That wastes the
 * scarcest thing in this project — the operator's attention on a real defect.
 *
 * So the dev DB should be **derived, not sedimented**: everything in it comes from a migration
 * or a seed in the current tree, and anything else is gone. If a row can't be reproduced by
 * this script, it shouldn't be in the database.
 *
 *   npm run db:reset:dev                       # truncate, migrate, seed (fleet + crew + reservation)
 *   npm run db:reset:dev -- --seeds fleet,gratuity
 *   npm run db:reset:dev -- --fresh            # DROP the schema and re-run every migration from zero
 *   npm run db:reset:dev -- --no-seed          # empty database, schema only
 *
 * `--fresh` is the stronger form: it drops and re-applies the whole migration ledger, which is
 * the only way to catch a migration that only works on a database that already has state (bad
 * ordering, a column another migration assumed). Worth running before shipping a migration.
 *
 * **Guarded against every database that isn't dev.** Refuses unless the target resolves to a
 * local host AND its database name is on the allowlist. The pilot/prod reset (`reset-pilot.ts`)
 * is the one with confirm tokens and an expected-DB check; this one simply cannot be pointed at
 * anything remote, which is a stronger guarantee than a token you can typo past.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { DEFAULT_DATABASE_URL, migrate } from "./migrate.js";
import { vesselDateOf } from "../src/config/tenant.js";

/** Database names this script will touch. Anything else aborts. */
const ALLOWED_DB_NAMES = new Set(["muster_dev", "muster_test"]);
/** Hosts this script will touch. A remote host aborts regardless of the DB name. */
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db", "postgres"]);

/**
 * **The standard dev world** (#937). One command, the same shape every time: boats, crew,
 * an offering, a month of realistic bookings, trips, shifts, and an at-risk board. If you
 * are hand-testing, this is all you should ever need to type.
 *
 * Everything else stays opt-in because it builds DELIBERATE breakage — `overlap` manufactures
 * a double-booked hull, `losing-asks` writes state the code cannot produce, `timeclock` leaves
 * payroll permanently 409, `split` re-forms shifts over every vessel-day, `outbox` rewrites
 * `crew-eric-stoffer` with a different name, role and phone than `crew` gives it, `completion`
 * is not idempotent, and `gratuity` picks whichever crew it finds first. Adding any of them
 * here would trade a known world for a surprising one, which is the bug this set exists to fix.
 *
 * The dates move with the calendar and that is deliberate — the seeds are relative to
 * `SEED_TODAY` (below), so the world is always current rather than aging into the past.
 */
const DEFAULT_SEEDS = ["fleet", "crew", "reservation", "xola", "atrisk"] as const;

/** seed name → npm script. Keep in sync with package.json's `db:seed:*`. */
const SEEDS: Record<string, string> = {
  fleet: "db:seed:fleet",
  crew: "db:seed:crew",
  atrisk: "db:seed:atrisk",
  outbox: "db:seed:outbox",
  split: "db:seed:split",
  gratuity: "db:seed:gratuity",
  reservation: "db:seed:reservation",
  timeclock: "db:seed:timeclock",
  // Were real `db:seed:*` scripts with no entry here, so `--seeds <name>` rejected them (#937).
  xola: "db:seed:xola",
  overlap: "db:seed:overlap",
  concurrent: "db:seed:concurrent",
  completion: "db:seed:completion",
  "losing-asks": "db:seed:losing-asks",
};

/**
 * ORDER MATTERS for some of these, and it is enforced by exit codes rather than declared:
 * `concurrent` refuses without `reservation`, `overlap` without a live offering, `gratuity`
 * without active crew. Run them after the standard set, not instead of it.
 */

interface Target {
  url: string;
  host: string;
  database: string;
}

/** Parse + validate the target. Throws with a specific reason rather than a generic refusal. */
export function resolveTarget(rawUrl: string): Target {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`DATABASE_URL is not a parseable URL — refusing to guess.`);
  }
  const host = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, "");

  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `Refusing to reset a database on host "${host}". This script only ever touches a local ` +
        `database (${[...ALLOWED_HOSTS].join(", ")}). For a real deployment use db/reset-pilot.ts, ` +
        `which has confirm tokens and an expected-database check.`,
    );
  }
  if (!ALLOWED_DB_NAMES.has(database)) {
    throw new Error(
      `Refusing to reset database "${database}" — not on the allowlist ` +
        `(${[...ALLOWED_DB_NAMES].join(", ")}). Rename it or add it to ALLOWED_DB_NAMES in ` +
        `db/reset-dev.ts if this really is a throwaway dev database.`,
    );
  }
  return { url: rawUrl, host, database };
}

/** Drop every app table (and the migration ledger) so migrations re-run from zero. */
async function dropSchema(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // `drop schema public cascade` also takes types/sequences a table drop would leave behind.
    await client.query("drop schema public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }
}

/** Truncate every app table, preserving the schema and the migration ledger. */
async function truncateAll(url: string): Promise<number> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and tablename <> '_migrations'`,
    );
    if (rows.length === 0) return 0;
    // CASCADE matters now: the schema carries real foreign keys as of DEC-131, so truncating a
    // parent without it would fail rather than silently succeed as it used to.
    await client.query(
      `truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`,
    );
    return rows.length;
  } finally {
    await client.end();
  }
}

export function parseSeeds(argv: readonly string[]): string[] {
  if (argv.includes("--no-seed")) return [];

  // BOTH spellings. `--seeds=a,b` is one argv token, so the old `indexOf("--seeds")` missed it
  // and fell through to DEFAULT_SEEDS — a reset that reported success while seeding something
  // other than what was asked for, with the empty page showing up minutes later somewhere
  // unrelated. Defaulting is only correct when no --seeds flag was given AT ALL; a flag that
  // was given and not understood must be loud.
  const eq = argv.find((a) => a.startsWith("--seeds="));
  const i = argv.indexOf("--seeds");
  if (eq === undefined && i === -1) return [...DEFAULT_SEEDS];
  const raw = eq !== undefined ? eq.slice("--seeds=".length) : argv[i + 1];
  if (!raw) throw new Error("--seeds needs a comma-separated list, e.g. --seeds fleet,reservation");
  const names = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = names.filter((n) => !(n in SEEDS));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown seed(s): ${unknown.join(", ")}. Available: ${Object.keys(SEEDS).join(", ")}`,
    );
  }
  return names;
}

async function main(argv: readonly string[]): Promise<void> {
  const target = resolveTarget(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  const fresh = argv.includes("--fresh");
  const seeds = parseSeeds(argv);

  console.log(`Target    ${target.database} @ ${target.host}`);
  console.log(`Mode      ${fresh ? "FRESH (drop schema, re-run every migration)" : "truncate + migrate"}`);
  console.log(`Seeds     ${seeds.length > 0 ? seeds.join(", ") : "(none)"}\n`);

  if (fresh) {
    await dropSchema(target.url);
    console.log("· schema dropped");
    const applied = await migrate(target.url);
    console.log(`· migrated (${applied.length} migration${applied.length === 1 ? "" : "s"} applied)`);
  } else {
    const applied = await migrate(target.url);
    if (applied.length > 0) {
      console.log(`· migrated (${applied.length} new)`);
    }
    const cleared = await truncateAll(target.url);
    console.log(`· truncated ${cleared} table${cleared === 1 ? "" : "s"}`);
  }

  // ONE clock read for the whole reset (#937). Each seed is its own process, so left alone
  // they each call `Date.now()` a second or two apart — which is identical every time except
  // across a midnight, where half the world lands on one day and half on the next. Pinning it
  // here also means `SEED_TODAY=2026-03-14 npm run db:reset:dev` reproduces a world exactly.
  //
  // NOT a fixed constant, deliberately. A pinned date ages: set it once and two months later
  // every shift is in the past, nothing is upcoming and the app looks empty. The world stays
  // relative to today and keeps its SHAPE — same boats, same crew, same offsets — which is
  // what the muscle memory is actually built on.
  const seedToday = process.env.SEED_TODAY ?? vesselDateOf(new Date());

  for (const name of seeds) {
    // Run each seed as its own process so it picks up .env.local exactly as it does standalone —
    // the seeds are first-class fixtures and must behave identically here and when run by hand.
    try {
      execFileSync("npm", ["run", SEEDS[name]!], {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: target.url, SEED_TODAY: seedToday },
      });
    } catch {
      // Say WHICH seed died and what to do about it. Before #937 a non-zero exit killed the
      // whole reset with npm's own error and no indication of which of five had failed —
      // `gratuity` exits 1 when it finds no active crew, and `outbox` has its own paths.
      console.error(
        `\n✗ seed "${name}" (npm run ${SEEDS[name]}) exited non-zero — its output is above.\n` +
          `  The database is migrated and the seeds before it ran. Re-run just this one with:\n` +
          `    SEED_TODAY=${seedToday} npm run ${SEEDS[name]}\n`,
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\nDONE — ${target.database} rebuilt from migrations + seeds.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
