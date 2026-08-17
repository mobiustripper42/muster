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

function callSites(): { file: string; passesFlag: boolean }[] {
  const hits: { file: string; passesFlag: boolean }[] = [];
  for (const dir of SEARCH_DIRS) {
    for (const abs of filesUnder(join(ROOT, dir))) {
      const src = readFileSync(abs, "utf8");
      if (!/\bformShifts\s*\(/.test(src)) continue;
      const rel = abs.replace(ROOT + "/", "");
      // The options object may be inline or spread over several lines; the flag is the signal.
      hits.push({ file: rel, passesFlag: /notifyTripChanges:\s*true/.test(src) });
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

  for (const { file, passesFlag } of sites) {
    const reason = SILENT_BY_DESIGN[file];
    if (reason) {
      it(`${file} — silent by design (${reason})`, () => {
        expect(reason.length).toBeGreaterThan(0);
      });
    } else {
      it(`${file} — passes notifyTripChanges`, () => {
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
