/**
 * `db:new-migration <name>` — scaffold a timestamped migration (DEC-121).
 *
 * Filenames are `YYYYMMDDHHMMSS_slug.sql` (UTC, 14 digits, no separators). The runner
 * (`db/migrate.ts`) orders by lexical filename sort and keys idempotency on the filename,
 * never on a sequence number — so a timestamp is a perfectly good name, and because two
 * branches authoring at different moments get different stamps, cross-branch collision is
 * structurally impossible. Every legacy `00NN_` sorts before every timestamp ('0' < '2'),
 * so numbered migrations always apply first, then timestamped ones in chronological order.
 *
 * NEVER hand-author a numbered migration again (a fresh `00NN_` would sort *before* applied
 * timestamps and reorder history on a clean DB). Always generate via this script.
 *
 *   npm run db:new-migration add-widget-table
 *   → db/migrations/20260715143012_add_widget_table.sql
 */
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

const rawName = process.argv.slice(2).join(" ").trim();
if (!rawName) {
  console.error("usage: npm run db:new-migration <name>");
  process.exit(1);
}

const slug = rawName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  // A migration name a developer types at their own terminal.
  // eslint-disable-next-line sonarjs/super-linear-regex -- developer-typed name
  .replace(/^_+|_+$/g, "");
if (!slug) {
  console.error(`error: '${rawName}' has no usable [a-z0-9] characters for a slug`);
  process.exit(1);
}

/** UTC 14-digit stamp — keeps lexicographic order == chronological order. */
function stamp(d: Date): string {
  const p = (n: number, w = 2) => n.toString().padStart(w, "0");
  return (
    p(d.getUTCFullYear(), 4) +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}

// Bump +1s until the name is free — defends the one-machine "generated two in the same
// second" case (cross-branch same-second collision is astronomically unlikely at human
// cadence, and the merge would surface it as a normal filename conflict anyway).
let when = new Date();
let filename = `${stamp(when)}_${slug}.sql`;
while (existsSync(join(MIGRATIONS_DIR, filename))) {
  when = new Date(when.getTime() + 1000);
  filename = `${stamp(when)}_${slug}.sql`;
}

const path = join(MIGRATIONS_DIR, filename);
writeFileSync(
  path,
  `-- ${filename} — ${rawName}\n` +
    `-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.\n\n`,
);
console.log(path);
