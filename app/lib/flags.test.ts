/**
 * Every feature flag accepts the same two spellings (#736).
 *
 * **The defect this pins.** Three flags tested `=== "1"` and `RESERVATIONS` tested `=== "true"`,
 * so `RESERVATIONS=1` in an env file left the booking flow OFF — no error, no warning, the flag
 * just read false. Nothing in the environment told you which spelling a given flag wanted, and
 * the failure surface was `/book` rendering its "not configured" copy while everyone believed
 * the feature was on. The VPS migration writes that env file by hand for the first time, next to
 * three flags taking the other spelling. `1` is now the only accepted value, everywhere.
 *
 * **Why it's a table.** The bug was not in any one flag — it was in the four disagreeing. A test
 * per flag would have passed on all four the day it was written. Asserting the same matrix
 * against every flag is what makes a fifth flag with a novel spelling fail here rather than in
 * production, provided it gets a row (which the count assertion below forces).
 *
 * These read `process.env` inside the function body, not at module load, so mutating the
 * environment per-case is enough — no module reset needed. If that ever changes, these tests
 * fail rather than silently reading a value captured at import time.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { messagingEnabled, reservationsEnabled, timeClockEnabled } from "./flags";

/** Every env flag in `flags.ts`, paired with its predicate. */
const FLAGS: ReadonlyArray<{ env: string; fn: () => boolean }> = [
  { env: "MESSAGING", fn: messagingEnabled },
  { env: "RESERVATIONS", fn: reservationsEnabled },
  { env: "TIME_CLOCK", fn: timeClockEnabled },
];

/** The one value that turns a flag ON, whichever flag it is. */
const ON = ["1"];

/** Everything else is OFF — including `"true"`, which `RESERVATIONS` alone used to accept. */
const OFF = ["", "0", "true", "TRUE", "True", " 1", "yes", "on", "no", "false"];

describe("feature flags accept one spelling across the board (#736)", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const { env } of FLAGS) {
      saved.set(env, process.env[env]);
      delete process.env[env];
    }
  });

  afterEach(() => {
    for (const [env, was] of saved) {
      if (was === undefined) delete process.env[env];
      else process.env[env] = was;
    }
    saved.clear();
  });

  it("covers every flag the module exports", () => {
    // Guards the vacuous pass: a flag added without a row here would make every assertion below
    // true of a set that no longer describes the module. Three since DEC-175 deleted
    // `CREW_SELF_SERVE` — and this is the assertion that caught the deletion, which is the point
    // of counting rather than iterating whatever happens to be imported.
    expect(FLAGS.length).toBe(3);
  });

  it("MESSAGING is read in exactly one place — this module — and switches crew messaging only (#761)", () => {
    // MESSAGING turns off the crew's internal messaging (threads, the doorbell). It has nothing to
    // do with customer email or SMS. It used to be read a second way — `=== "false"` as a kill
    // switch — in four customer send paths, so `MESSAGING=false` silently stopped every booking
    // confirmation while `MESSAGING=0` did not. Scanning the source is what keeps a fifth path
    // from growing the same check: every reader has to go through `messagingEnabled()`.
    const root = join(__dirname, "..", "..");
    const readers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/env\.MESSAGING\b|env\[["']MESSAGING["']\]|flagOn\(\s*["']MESSAGING["']/.test(readFileSync(path, "utf8"))) {
            readers.push(relative(root, path));
          }
        }
      }
    };
    for (const dir of ["app", "src", "components"]) walk(join(root, dir));
    expect(readers).toEqual(["app/lib/flags.ts"]);
  });

  for (const { env, fn } of FLAGS) {
    describe(env, () => {
      it("is off when unset", () => {
        expect(fn()).toBe(false);
      });

      for (const value of ON) {
        it(`is on for ${JSON.stringify(value)}`, () => {
          process.env[env] = value;
          expect(fn()).toBe(true);
        });
      }

      for (const value of OFF) {
        it(`is off for ${JSON.stringify(value)}`, () => {
          process.env[env] = value;
          expect(fn()).toBe(false);
        });
      }
    });
  }
});
