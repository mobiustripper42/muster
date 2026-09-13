/**
 * Test-only helper: form **every** vessel-day the repository knows about (#999).
 *
 * `formShifts` takes a required scope, and that is the point — a caller states which vessel-days
 * its run covers, so no production path can sweep the fleet by omission. Dozens of existing tests
 * predate that and are not *about* scope: they seed a small world, form it, and assert on the
 * result. Rewriting each to enumerate its own days would be churn that tests the fixture rather
 * than the engine, on files whose subject is the seat fold, the tick, or the ask loop.
 *
 * So this exists, and its name is the guard. **`ForTest` is in the identifier and the file is
 * `*-test-support`**, because the one thing that must never happen is production code reaching
 * for a convenient "form everything" — which is the entire defect #999 removes. A reviewer seeing
 * this imported outside a `.test.ts` has found a bug without needing to know why.
 *
 * `check:denied` and lint do not police this; the name does. It is the same posture as
 * `makeTwilioChannel` no longer being exported (#955): make the wrong thing hard to reach for and
 * obvious when someone did.
 *
 * The tests that ARE about scope — "forms every vessel-day it was asked for, and NO others",
 * "an empty scope forms nothing" — call `formShifts` directly with explicit days. They must.
 */

import type { Repository } from "../ports/repository.js";
import { formShifts, type FormResult } from "./form-shifts.js";

/** Wide enough to mean "no date bound" against vessel-local ISO dates, which sort lexically. */
const ALL_DATES = { from: "0000-01-01", to: "9999-12-31" } as const;

export async function formAllVesselDaysForTest(
  repo: Repository,
  opts?: { now?: Date; leadDays?: number; notifyTripChanges?: boolean },
): Promise<FormResult> {
  const days = await repo.listActiveVesselDays(ALL_DATES.from, ALL_DATES.to);
  return formShifts(repo, days, opts);
}
