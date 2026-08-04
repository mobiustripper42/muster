/**
 * Every time-clock entry point is gated on `TIME_CLOCK` (#628).
 *
 * **Why this test is shaped like a grep.** A kill switch is only worth the entry point it misses.
 * #621 is the standing example in this repo: the RESERVATIONS switch hid its nav links and left
 * the admin routes reachable by URL, so the feature was "off" and fully operable. The failure is
 * never in the gate you wrote — it's in the seventh file, added later, by someone who gated the
 * page and forgot the server action underneath it.
 *
 * Playwright can't cover this: `TIME_CLOCK` is process env on the server the whole suite shares,
 * so a spec cannot turn it off for one test. That leaves the choice between asserting the wiring
 * structurally and asserting nothing. This is the structural version — it fails the moment a new
 * `/crew/time` or `/admin/time-clock` file appears without the predicate, which is the actual
 * failure mode, and it needs updating exactly when someone adds a surface (at which point they
 * should be thinking about the gate anyway).
 *
 * It deliberately checks the SOURCE rather than behaviour. A behavioural test would need the flag
 * off, which is the thing we can't arrange; a source check at least cannot be satisfied by a file
 * that merely imports the helper and never calls it — the assertion is on the call.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Every `.ts`/`.tsx` under a directory, recursively. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/** The surfaces §2.9 owns: both route trees plus the export route. */
const GATED_DIRS = [
  "app/(crew)/crew/time",
  "app/(admin)/admin/time-clock",
  "app/(admin)/admin/payroll/gusto.csv",
];

describe("the TIME_CLOCK kill switch reaches every door", () => {
  const files = GATED_DIRS.flatMap((d) => filesUnder(join(ROOT, d)));

  it("finds the surfaces at all (a moved directory must not silently pass)", () => {
    // Without this, renaming a route turns every assertion below into a vacuous pass over an
    // empty list — the classic way a coverage test starts approving of nothing.
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const dir of GATED_DIRS) {
    it(`${dir} — every file calls timeClockEnabled()`, () => {
      for (const f of filesUnder(join(ROOT, dir))) {
        const src = readFileSync(f, "utf8");
        expect(src, `${f.replace(ROOT + "/", "")} must call timeClockEnabled()`).toMatch(
          /timeClockEnabled\(\)/,
        );
      }
    });
  }

  it("gates every exported server action, not just the page above it", () => {
    // A server action is a POST endpoint. Gating the page and not these is the #621 shape.
    for (const f of [
      "app/(crew)/crew/time/actions.ts",
      "app/(admin)/admin/time-clock/actions.ts",
    ]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      const exported = src.match(/^export async function /gm)?.length ?? 0;
      const gates = src.match(/if \(!timeClockEnabled\(\)\)/g)?.length ?? 0;
      expect(exported, `${f} should export at least one action`).toBeGreaterThan(0);
      expect(gates, `${f}: ${exported} actions but ${gates} gates`).toBe(exported);
    }
  });
});
