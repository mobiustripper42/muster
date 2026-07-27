// Tests for the DECISIONS.md validator (#564).
//
// The script decides whether the build passes, which is the same argument that put
// `db/**` in the vitest include — a guard nobody tests is a guard nobody trusts.
// Fixtures are minimal hand-written records, not slices of the real file, so a
// legitimate edit to DECISIONS.md never turns these red.

import { describe, expect, it } from "vitest";
import { checkDecisions } from "./check-decisions.mjs";

/** A minimal well-formed record: two indexed decisions plus the tally. */
const good = `# Decisions

## Index

### Some topic
- DEC-001 — first thing
- DEC-002 — second thing

_Indexed 2 of 2 DECs._

---

## DEC-001: First thing

Body text citing DEC-002.

## DEC-002: Second thing

Body text.
`;

describe("checkDecisions", () => {
  it("passes a well-formed record", () => {
    const { failures, decisions, indexRows } = checkDecisions(good);
    expect(failures).toEqual([]);
    expect(decisions).toBe(2);
    expect(indexRows).toBe(2);
  });

  it("catches a duplicate id — the #562 cross-branch collision", () => {
    const text = good.replace("## DEC-002: Second thing\n\nBody text.", "## DEC-001: Colliding thing\n\nBody text.");
    const { failures } = checkDecisions(text);
    expect(failures.some((f) => f.includes("duplicate id DEC-001"))).toBe(true);
  });

  it("catches a decision with no index row — the DEC-127 decay mode", () => {
    const text = good.replace("- DEC-002 — second thing\n", "").replace("Indexed 2 of 2", "Indexed 1 of 2");
    const { failures } = checkDecisions(text);
    expect(failures.some((f) => f.includes("DEC-002 has no index row"))).toBe(true);
  });

  it("catches an index row whose decision was deleted", () => {
    const text = good.replace("- DEC-002 — second thing", "- DEC-099 — a decision that never landed");
    const { failures } = checkDecisions(text);
    expect(failures.some((f) => f.includes("index row for DEC-099"))).toBe(true);
  });

  it("catches a dangling reference in body prose", () => {
    const text = good.replace("citing DEC-002", "citing DEC-100");
    const { failures } = checkDecisions(text);
    expect(failures.some((f) => f.includes("reference to DEC-100"))).toBe(true);
  });

  it("catches a stale tally", () => {
    const { failures } = checkDecisions(good.replace("Indexed 2 of 2", "Indexed 124 of 124"));
    expect(failures.some((f) => f.includes('tally reads "Indexed 124 of 124"'))).toBe(true);
  });

  it("catches a missing tally", () => {
    const { failures } = checkDecisions(good.replace("_Indexed 2 of 2 DECs._\n", ""));
    expect(failures.some((f) => f.includes("no `_Indexed N of M DECs` tally"))).toBe(true);
  });

  it("ignores the seeds repo's DEC-S series, whose record lives elsewhere", () => {
    const text = good.replace("citing DEC-002", "citing DEC-002 and DEC-S019 and DEC-S026");
    expect(checkDecisions(text).failures).toEqual([]);
  });

  it("resolves compound prose tokens like DEC-001-family to the bare id", () => {
    const text = good.replace("citing DEC-002", "citing the DEC-002-family of islands");
    expect(checkDecisions(text).failures).toEqual([]);
  });

  it("reads an amendment heading as a section, not a second decision", () => {
    const text = good.replace(
      "## DEC-002: Second thing",
      "## DEC-001 amendment (11.2b) — on-demand collection\n\nMore body.\n\n## DEC-002: Second thing",
    );
    const { failures, decisions, amendments } = checkDecisions(text);
    expect(failures).toEqual([]);
    expect(decisions).toBe(2);
    expect(amendments).toBe(1);
  });

  it("catches an amendment hanging off a decision that does not exist", () => {
    const text = good.replace(
      "## DEC-002: Second thing",
      "## DEC-077 amendment — orphaned\n\nMore body.\n\n## DEC-002: Second thing",
    );
    const { failures } = checkDecisions(text);
    expect(failures.some((f) => f.includes("amendment section for DEC-077"))).toBe(true);
  });

  it("reads a struck row as an index row", () => {
    const text = good.replace("- DEC-002 — second thing", "- ~~DEC-002~~ → superseded by DEC-001 — second thing");
    expect(checkDecisions(text).failures).toEqual([]);
  });

  it("does not treat DEC-TBD as owing an index row", () => {
    const text = good.replace("## DEC-001: First thing", "## DEC-TBD: Open questions\n\nStuff.\n\n## DEC-001: First thing");
    expect(checkDecisions(text).failures).toEqual([]);
  });

  it("ignores index-shaped rows that appear inside a decision body", () => {
    // DEC-002 rather than an invented id: an unknown id would fail the reference scan
    // no matter what the boundary did, and the test would pass for the wrong reason.
    // With a real id, a broken boundary shows up as "duplicate index row for DEC-002".
    const text = `${good}\nSee also:\n- DEC-002 — prose in a body, not an index row\n`;
    const { failures, indexRows } = checkDecisions(text);
    expect(failures).toEqual([]);
    expect(indexRows).toBe(2);
  });

  it("ignores an example row in the preamble, above the first topic heading", () => {
    const text = good.replace("## Index", "## Index\n\nRows look like this:\n- DEC-001 — an illustrative example\n");
    const { failures, indexRows } = checkDecisions(text);
    expect(failures).toEqual([]);
    expect(indexRows).toBe(2);
  });

  it("catches the same decision listed twice in the index", () => {
    const text = good.replace("- DEC-002 — second thing", "- DEC-001 — listed twice\n- DEC-002 — second thing");
    const { failures } = checkDecisions(text);
    expect(failures.some((f) => f.includes("duplicate index row for DEC-001"))).toBe(true);
  });

  it("names the missing colon when a decision heading is typed without one", () => {
    const text = good.replace("## DEC-002: Second thing", "## DEC-002 Second thing");
    const { failures } = checkDecisions(text);
    expect(failures.some((f) => f.includes("needs a colon"))).toBe(true);
  });
});
