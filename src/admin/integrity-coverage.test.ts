/**
 * Every table in the schema is classified in TABLE_COVERAGE (#584).
 *
 * The failure this prevents: the diagnostic covered 12 entity types while the schema grew to
 * 37 tables, because adding a table never forced a decision about which safety net catches
 * it. The gap was invisible — a scan reporting zero orphans looks identical whether the spine
 * is intact or whether nothing is looking at it. Reading the table list from the migrations
 * rather than from a hand-kept constant is what makes this checkable at all.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TABLE_COVERAGE } from "./integrity-coverage.js";

const MIGRATIONS = "db/migrations";

/** Table names as the schema actually declares them. */
function tablesInSchema(): string[] {
  const names = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(`${MIGRATIONS}/${f}`, "utf8");
    for (const line of sql.split("\n")) {
      // Only real DDL — a `create table` inside a comment or a doc block doesn't count.
      if (line.trimStart().startsWith("--")) continue;
      const m = line.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+)/i);
      if (m?.[1]) names.add(m[1].toLowerCase());
    }
  }
  return [...names].sort();
}

describe("integrity coverage", () => {
  it("classifies every table in the schema", () => {
    const missing = tablesInSchema().filter((t) => !(t in TABLE_COVERAGE));
    // If this fails you added a table: say which net catches its references — a foreign key,
    // the diagnostic, or `exempt` with a reason. All three are fine; silence is not.
    expect(missing, "tables with no coverage decision").toEqual([]);
  });

  it("classifies nothing that isn't a table", () => {
    // The reverse drift: a table gets dropped or renamed and its entry lingers, making
    // coverage look broader than it is.
    const schema = new Set(tablesInSchema());
    const stale = Object.keys(TABLE_COVERAGE).filter((t) => !schema.has(t));
    expect(stale, "coverage entries for tables that no longer exist").toEqual([]);
  });

  it("finds a real schema, not an empty directory", () => {
    // Negative control for the reader itself: if the glob or the regex ever stops matching,
    // both tests above pass vacuously and the guard is silently inert (#589's lesson).
    expect(tablesInSchema().length).toBeGreaterThan(30);
    expect(tablesInSchema()).toContain("reservations");
  });

  it("gives every exemption a reason", () => {
    for (const [table, c] of Object.entries(TABLE_COVERAGE)) {
      if (c.kind === "exempt") {
        // Non-empty, not essay-length: the point is that a decision was recorded, and an
        // arbitrary character floor just teaches people to pad.
        expect(c.reason.trim().length, `${table} is exempt with no reason`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the fk entries honest against the migrations", () => {
    // A `kind: "fk"` claim is only true if a constraint actually exists. Read them back out
    // of the DDL rather than trusting the label — the whole point of this file is that a
    // claim about coverage is worthless unless something checks it.
    const ddl = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(`${MIGRATIONS}/${f}`, "utf8"))
      .join("\n");
    for (const [table, c] of Object.entries(TABLE_COVERAGE)) {
      if (c.kind !== "fk") continue;
      // TWO ways a foreign key gets declared in this schema, and the check has to see
      // both or it fails a table for having used the wrong dialect of "correct":
      //  1. The reservations-era backfill adds them from a `do $$` loop over
      //     (child, column, parent) value rows — `'table', 'column',`.
      //  2. A table created after that declares them INLINE on the column
      //     (`... references crew_members(id)`), which is how `time_punches` and
      //     `time_punch_edits` do it. Missed entirely until #635 marked a table `fk`
      //     that used only this form.
      const inLoop = new RegExp(`'${table}'\\s*,\\s*'[a-z_]+'\\s*,`).test(ddl);
      const created = ddl.match(
        new RegExp(`create\\s+table[^;]*?\\b${table}\\b[^;]*;`, "is"),
      )?.[0];
      const inline = created !== undefined && /\breferences\s+[a-z_]+\s*\(/i.test(created);
      expect(
        inLoop || inline,
        `${table} is marked fk but no constraint mentions it — neither the do-loop form nor an inline \`references\``,
      ).toBe(true);
    }
  });
});
