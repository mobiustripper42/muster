/**
 * The time clock — clock in, clock out, and the open-punch lookup (SPEC §2.9).
 *
 * A **timesheet, not a tracker**: this answers "how many hours do I pay this person
 * for this period", and nothing here exists to catch anyone lying (§2.9.3, the honor
 * system). No geofence, no device binding — the repair path is a human on
 * `/admin/time-clock`, not a rule.
 *
 * **The caller mints the id** (the `addTimeOff` convention — the core mints nothing
 * it can't make deterministic). Expected user errors return a `code` rather than
 * throw; the surface maps each to calm copy (the claim-service idiom).
 *
 * **One open punch per crew member, and the database is what enforces it** (§2.9.4).
 * The `getOpenPunchForCrew` read below makes the ordinary case deterministic on both
 * adapters, but two taps racing inside one round-trip would both pass it — so the
 * partial unique index `time_punches_one_open_per_crew` is the real guard, and
 * {@link clockIn} maps its 23505 back to `already_in`. The user sees a no-op either
 * way; what they never see is a 500 or a second row.
 */

import type { TimePunch, TimePunchOrigin } from "../domain/entities.js";
import type { CrewMemberId, ShiftId, TimePunchId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { vesselDateOf } from "../config/tenant.js";

/** Expected, surfaced-to-the-user failures of {@link clockIn}. */
export type ClockInCode = "already_in";

export type ClockInResult =
  | { ok: true; punch: TimePunch }
  | { ok: false; code: ClockInCode };

/** Expected, surfaced-to-the-user failures of {@link clockOut}. */
export type ClockOutCode = "not_in" | "out_before_in";

export type ClockOutResult =
  | { ok: true; punch: TimePunch }
  | { ok: false; code: ClockOutCode };

/** Postgres unique-violation. The one-open-punch index is the only unique
 *  constraint `time_punches` carries, so on this table 23505 has one meaning. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/**
 * Go on the clock. Returns `already_in` — creating nothing — when a punch is already
 * open for this person, whether that's caught by the read below or by the index
 * underneath it.
 *
 * `origin` defaults to `"crew"`; the admin repair bench (13.3) passes `"admin"` so
 * hours nobody actually punched never look identical to hours they did (§2.9.8), and
 * so validation lives here rather than being re-implemented in a route.
 */
export async function clockIn(
  repo: Repository,
  input: {
    id: TimePunchId;
    crewMemberId: CrewMemberId;
    at: Date;
    origin?: TimePunchOrigin;
  },
): Promise<ClockInResult> {
  if (await repo.getOpenPunchForCrew(input.crewMemberId)) {
    return { ok: false, code: "already_in" };
  }

  const punch: TimePunch = {
    id: input.id,
    crewMemberId: input.crewMemberId,
    inAt: input.at.toISOString(),
    outAt: null,
    shiftId: await autoMatchShift(repo, input.crewMemberId, input.at),
    origin: input.origin ?? "crew",
    adminEditedAt: null,
  };

  try {
    await repo.saveTimePunch(punch);
  } catch (err) {
    // Lost the race to another tap in the same instant — the index refused the
    // second open row. Same answer as the read-path check: nothing was written.
    if (isUniqueViolation(err)) return { ok: false, code: "already_in" };
    throw err;
  }
  return { ok: true, punch };
}

/**
 * Come off the clock. `not_in` when nothing is open — never invents a punch to close.
 * `out_before_in` when the proposed `outAt` is at or before its `inAt`; a zero-length
 * punch is not a punch, and the open punch is left untouched so a human can fix it.
 */
export async function clockOut(
  repo: Repository,
  crewMemberId: CrewMemberId,
  at: Date,
): Promise<ClockOutResult> {
  const open = await repo.getOpenPunchForCrew(crewMemberId);
  if (!open) return { ok: false, code: "not_in" };

  const outAt = at.toISOString();
  if (Date.parse(outAt) <= Date.parse(open.inAt)) {
    return { ok: false, code: "out_before_in" };
  }

  const closed: TimePunch = { ...open, outAt };
  await repo.saveTimePunch(closed);
  return { ok: true, punch: closed };
}

/** The crew member's open punch, or null. At most one can exist (§2.9.4) — the
 *  "Clock in vs Clock out" decision on `/crew/time` reads exactly this. */
export async function openPunchFor(
  repo: Repository,
  crewMemberId: CrewMemberId,
): Promise<TimePunch | null> {
  return repo.getOpenPunchForCrew(crewMemberId);
}

/**
 * The shift this punch appears to belong to — **nobody picks one from a dropdown at
 * 6am** (§2.9.2). The shift on the **vessel-local** date of `at` (DEC-032 — an 8pm
 * Eastern punch is already tomorrow in UTC, and bucketing on that would tag the wrong
 * boat and the wrong paycheck) where this person holds a **Confirmed required** seat:
 * the same filter `buildPayrollReport` uses, so the estimate and the actual agree on
 * what "worked this shift" means.
 *
 * **Exactly one** match tags it; zero or several leave it null and the punch still
 * stands. An ambiguous tag is worse than none, and hours are owed either way.
 */
async function autoMatchShift(
  repo: Repository,
  crewMemberId: CrewMemberId,
  at: Date,
): Promise<ShiftId | null> {
  const date = vesselDateOf(at);
  const matches: ShiftId[] = [];

  for (const shift of await repo.listShifts()) {
    if (shift.date !== date) continue;
    if (shift.state === "Cancelled") continue; // nobody is crewing it
    for (const seat of await repo.listSeatsForShift(shift.id)) {
      if (
        seat.state === "Confirmed" &&
        seat.kind === "required" &&
        seat.assignedCrewMemberId === crewMemberId
      ) {
        matches.push(shift.id);
        break; // one shift can only match once, however many seats say so
      }
    }
    if (matches.length > 1) return null; // ambiguous — stop looking
  }

  return matches.length === 1 ? matches[0]! : null;
}
