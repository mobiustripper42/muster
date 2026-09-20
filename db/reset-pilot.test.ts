/**
 * The classification list is complete (issue #1047).
 *
 * `reset-pilot.ts` refuses to run when a table in `pg_tables` is in neither `KEEP` nor
 * `CLEAR`. That guard is correct and it fires at exactly the wrong moment: the operator
 * is at a terminal, pointed at production, about to wipe the pilot's data, and the
 * script stops to ask a design question about a table someone added three weeks ago.
 *
 * **This is the same defect the test-database truncate list had at issue #1031** — a
 * hand-maintained list of table names that drifts silently from the schema, discovered
 * only when something downstream behaves oddly. There the gap had been open long enough
 * to hide a cross-suite race. Here it would surface as an aborted prod reset.
 *
 * The drift guard that would catch it in CI is **deliberately not here yet** — see the
 * note inside the describe block. Writing it is what found the reason it cannot land
 * yet, which is the most useful thing this file has done so far.
 */

import { describe, expect, it } from "vitest";
import { KEEP, CLEAR } from "./reset-pilot.js";

describe("reset-pilot classification", () => {
  /**
   * **The whole-schema assertion is NOT here, and that is a finding rather than a gap.**
   *
   * Written first, it failed immediately on **22 pre-existing unclassified tables** —
   * `payments`, `offerings`, `admins`, `booking_codes`, `audit_events`, `gratuity`,
   * `time_punches` and sixteen more. The list stopped tracking the schema many migrations
   * ago, which means `reset-pilot.ts` **aborts on its own guard today**: a destructive
   * prod tool that cannot run is not a safe tool, it is an unavailable one.
   *
   * Classifying 22 tables is 22 decisions about production data — `payments` alone is a
   * serious one — and it is not this issue's work. Filed separately. The ratchet belongs
   * with that fix, not ahead of it, because a test pinned to a 22-table baseline would
   * bake in the defect it exists to remove.
   *
   * One caution for whoever takes it: **do not derive the list from a local `muster_test`.**
   * `db:reset:test` truncates rather than drops, so `muster_owned_vessel_days` is still
   * there locally despite `20260806230000` dropping it — the migration is in `_migrations`
   * and never re-runs. The same trap cost a census at issue #1031. Replay into a scratch
   * database.
   */

  it("no table is in both lists", () => {
    const both = CLEAR.filter((t) => KEEP.has(t));
    expect(both).toEqual([]);
  });

  it("the reservation trail is CLEAR, and its absence from KEEP is deliberate", () => {
    // Pinned by name because it is the one classification in the list that a cascade
    // will NOT make for you: the trail has no foreign key to `reservations`, so
    // truncating the parent leaves it untouched. If someone "tidies" it into KEEP, a
    // pilot reset produces a trail describing bookings that no longer exist.
    expect(CLEAR).toContain("reservation_trail");
    expect(KEEP.has("reservation_trail")).toBe(false);
  });
});
