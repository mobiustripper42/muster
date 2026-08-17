/**
 * Every `formShifts` caller that can move a crewed day passes `notifyTripChanges` (#765).
 *
 * **Why this test is shaped like a grep.** The bug it pins was not a wrong line — it was a
 * MISSING one, in a caller written months after the flag was introduced. `formShifts` reports a
 * changed trip set in `changedCrew` only when the caller opts in, so a new call site that forgets
 * the flag silently stops telling crew their day moved. Nothing fails, nothing logs, and the
 * notice quietly becomes dead code. That is precisely what had happened: the Xola import and the
 * manual split/merge opted in; the booking webhook, the cancel path and the cron tick did not —
 * and after the DEC-126 cutover those last two are the only formation triggers left.
 *
 * A behavioural test cannot cover this class. Each caller has its own test proving IT notifies
 * (`booking-webhook.test.ts`, `cancel-reservation.test.ts`, `form-shifts.test.ts`), and every one
 * of them passed while the defect was live — because a test for a caller that does not exist yet
 * cannot be written. The failure is in the SEVENTH file, added later, by someone who wired the
 * formation and never thought about the notice. This asserts the wiring, so that file fails here.
 *
 * It deliberately reads source rather than behaviour, the same trade `app/lib/time-clock-gate.test.ts`
 * makes and for the same reason: the alternative is asserting nothing.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SEARCH_DIRS = ["src", "app", "db"];

/** Every `.ts`/`.tsx` under a directory, recursively, excluding tests. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Callers that legitimately stay silent, each with the reason it is not a defect.
 * Adding a file here is a deliberate act; forgetting the flag is not.
 */
const SILENT_BY_DESIGN: Record<string, string> = {
  "src/builder/form-shifts.ts": "the definition itself",
  "db/seed-split-dev.ts": "a dev seed — builds a world from nothing, no crew to tell",
};

/**
 * Strip block and line comments. Non-negotiable: every file this rule governs *discusses*
 * `notifyTripChanges` in prose right next to the call, so a raw text match would be satisfied by
 * the comment explaining the flag even after someone deleted the flag itself — a guard that reads
 * its own documentation and calls it compliance (@code-review).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The argument text of one call, by balancing parentheses from the opening one. */
function argsAt(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
  }
  return src.slice(openParen + 1);
}

/**
 * One entry per CALL, not per file. A file with a correct flagged call plus a second unflagged
 * one must fail — file-level matching would report it green on the strength of the first.
 */
function callSites(): { file: string; passesFlag: boolean }[] {
  const hits: { file: string; passesFlag: boolean }[] = [];
  for (const dir of SEARCH_DIRS) {
    for (const abs of filesUnder(join(ROOT, dir))) {
      const src = stripComments(readFileSync(abs, "utf8"));
      const rel = abs.replace(ROOT + "/", "");
      const re = /\bformShifts\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        // Skip the declaration itself (`export async function formShifts(`).
        const before = src.slice(Math.max(0, m.index - 40), m.index);
        if (/function\s+$/.test(before)) continue;
        const args = argsAt(src, m.index + m[0].length - 1);
        hits.push({ file: rel, passesFlag: /notifyTripChanges:\s*true/.test(args) });
      }
    }
  }
  return hits;
}

describe("every formShifts caller opts into the change notice (#765)", () => {
  const sites = callSites();

  it("finds the call sites at all (a renamed function must not silently pass)", () => {
    // Without this, renaming `formShifts` turns every assertion below into a vacuous pass over an
    // empty list — a coverage test that has started approving of nothing.
    expect(sites.length).toBeGreaterThanOrEqual(6);
  });

  it("finds the callers that were silent when this was written", () => {
    // Pins that the search actually reaches the files the bug lived in, across all three roots.
    // A glob that quietly stopped descending into `app/` would otherwise look like a clean pass.
    const files = sites.map((s) => s.file);
    expect(files).toContain("src/reservations/booking-webhook.ts");
    expect(files).toContain("src/reservations/cancel-reservation.ts");
    expect(files).toContain("app/api/cron/tick/route.ts");
  });

  it("reads code, not the comments about the code", () => {
    // The regression @code-review caught in the first cut. Every file governed by this rule
    // explains `notifyTripChanges` in prose beside the call, so a whole-file text match stays
    // green after the flag is deleted from the argument — the guard quoting its own
    // documentation back as evidence. Pin that comments are invisible to the matcher.
    const withOnlyAComment = stripComments(`
      // notifyTripChanges: true — we should really pass this
      /* notifyTripChanges: true */
      await formShifts(repo, { now });
    `);
    expect(withOnlyAComment).not.toMatch(/notifyTripChanges/);
  });

  it("reports one result per call, not per file", () => {
    // A file with a correct flagged call plus a second unflagged one must not be reported green
    // on the strength of the first.
    const twoCalls = `
      await formShifts(repo, { now, notifyTripChanges: true });
      await formShifts(repo, { now });
    `;
    const found: boolean[] = [];
    const re = /\bformShifts\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(twoCalls))) {
      found.push(/notifyTripChanges:\s*true/.test(argsAt(twoCalls, m.index + m[0].length - 1)));
    }
    expect(found).toEqual([true, false]);
  });

  for (const [i, { file, passesFlag }] of sites.entries()) {
    const reason = SILENT_BY_DESIGN[file];
    if (reason) {
      it(`${file} — silent by design (${reason})`, () => {
        expect(reason.length).toBeGreaterThan(0);
      });
    } else {
      it(`${file} — call ${i + 1} passes notifyTripChanges`, () => {
        expect(
          passesFlag,
          `${file} calls formShifts without notifyTripChanges: true. A trip-set change on a ` +
            `crewed day will compute the diff and tell nobody. Either pass the flag, or add the ` +
            `file to SILENT_BY_DESIGN with the reason it cannot move a crewed day.`,
        ).toBe(true);
      });
    }
  }
});
