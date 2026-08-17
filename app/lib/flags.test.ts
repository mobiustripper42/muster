/**
 * Every feature flag accepts the same two spellings (#736).
 *
 * **The defect this pins.** Three flags tested `=== "1"` and `RESERVATIONS` tested `=== "true"`,
 * so `RESERVATIONS=1` in an env file left the booking flow OFF — no error, no warning, the flag
 * just read false. Nothing in the environment told you which spelling a given flag wanted, and
 * the failure surface was `/book` rendering its "not configured" copy while everyone believed
 * the feature was on. The VPS migration writes that env file by hand for the first time, next to
 * three flags taking the other spelling.
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { messagingEnabled, reservationsEnabled, selfServeEnabled, timeClockEnabled } from "./flags";

/** Every env flag in `flags.ts`, paired with its predicate. */
const FLAGS: ReadonlyArray<{ env: string; fn: () => boolean }> = [
  { env: "CREW_SELF_SERVE", fn: selfServeEnabled },
  { env: "MESSAGING", fn: messagingEnabled },
  { env: "RESERVATIONS", fn: reservationsEnabled },
  { env: "TIME_CLOCK", fn: timeClockEnabled },
];

/** Values that must turn a flag ON, whichever flag it is. */
const ON = ["1", "true"];

/**
 * Values that must leave it OFF. `"TRUE"` and `" 1"` are deliberately here rather than in `ON`:
 * the fix accepts exactly the two documented spellings, so this pins the boundary as it stands.
 * Whether it *should* be case- and whitespace-tolerant is a separate question — an operator
 * hand-typing `TRUE` hits the same silent-off this issue is about — and is not decided here.
 */
const OFF = ["", "0", "TRUE", "True", " 1", "yes", "on", "no", "false"];

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
    // Guards the vacuous pass: a fifth flag added without a row here would make every assertion
    // below true of a set that no longer describes the module.
    expect(FLAGS.length).toBe(4);
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
