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
 * A punch's span is valid when it's still open, or ends strictly after it starts.
 * A zero-length punch is not a punch. ONE definition, shared by `clockOut`,
 * {@link addPunch} and {@link editPunch} — the admin surface must not re-implement
 * validation the domain already owns (#627 AC).
 */
function spanIsValid(inAt: string, outAt: string | null): boolean {
  return outAt === null || Date.parse(outAt) > Date.parse(inAt);
}

/**
 * No punch may claim time that hasn't happened yet (operator, 2026-08-01).
 *
 * Hours are a record of work done, not a plan. The same rule covers "next Tuesday" and
 * "6pm today, entered at 2pm" — the second is only a finer-grained version of the first,
 * so there is one check rather than a date rule and a time rule that could disagree.
 *
 * `now` is not the future: clocking in stamps `new Date()` and must not be refused by
 * its own timestamp, so the comparison is strictly greater.
 */
function inTheFuture(instant: string | null, now: Date): boolean {
  return instant !== null && Date.parse(instant) > now.getTime();
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
  if (!spanIsValid(open.inAt, outAt)) {
    return { ok: false, code: "out_before_in" };
  }

  const closed: TimePunch = { ...open, outAt };
  await repo.saveTimePunch(closed);
  return { ok: true, punch: closed };
}

// ── The admin repair bench (#627, §2.9.5) ───────────────────────────────────
// Muster never guesses when someone went home, so a missed clock-out is closed by a
// human. These are the doors that human uses. They share `clockIn`/`clockOut`'s
// validation and error vocabulary rather than restating it at the route.

/** Expected, surfaced-to-the-operator failures of {@link addPunch}. */
export type AddPunchCode = "out_before_in" | "already_in" | "future";

export type AddPunchResult =
  | { ok: true; punch: TimePunch }
  | { ok: false; code: AddPunchCode };

/**
 * Enter a punch from scratch — the operator recording hours somebody worked without
 * tapping anything (#627). Stamped `origin: "admin"`, so it never looks identical to
 * one they tapped (§2.9.8), and **auto-matched exactly like a real clock-in** so a
 * back-entered punch carries the same shift association a live one would.
 *
 * `outAt: null` enters it OPEN, which is legitimate (correcting a missed clock-in
 * mid-shift) — and subject to the same one-open-punch rule, index included.
 */
export async function addPunch(
  repo: Repository,
  input: {
    id: TimePunchId;
    crewMemberId: CrewMemberId;
    inAt: Date;
    outAt: Date | null;
    /** The clock, injectable for tests. Defaults to the wall clock. */
    now?: Date;
    /**
     * Who is entering it. Defaults to `"admin"` — this door's original caller is the
     * repair bench. The crew's own door (#635) passes `"crew"`, because THEY entered
     * it, and passing it here rather than correcting the row afterwards is what keeps
     * the write atomic: one `saveTimePunch`, always with the right provenance.
     */
    origin?: TimePunchOrigin;
  },
): Promise<AddPunchResult> {
  const inAt = input.inAt.toISOString();
  const outAt = input.outAt === null ? null : input.outAt.toISOString();
  if (!spanIsValid(inAt, outAt)) return { ok: false, code: "out_before_in" };
  // `now` defaults to the wall clock: `clockIn` passes the instant it just stamped, so
  // the strict comparison lets it through while a hand-entered future time is refused.
  const now = input.now ?? new Date();
  if (inTheFuture(inAt, now) || inTheFuture(outAt, now)) {
    return { ok: false, code: "future" };
  }

  if (outAt === null && (await repo.getOpenPunchForCrew(input.crewMemberId))) {
    return { ok: false, code: "already_in" };
  }

  const punch: TimePunch = {
    id: input.id,
    crewMemberId: input.crewMemberId,
    inAt,
    outAt,
    shiftId: await autoMatchShift(repo, input.crewMemberId, input.inAt),
    origin: input.origin ?? "admin",
    adminEditedAt: null,
  };

  try {
    await repo.saveTimePunch(punch);
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, code: "already_in" };
    throw err;
  }
  return { ok: true, punch };
}

/** Expected, surfaced-to-the-operator failures of {@link editPunch}. */
export type EditPunchCode = "gone" | "out_before_in" | "day_moved" | "already_in" | "future";

export type EditPunchResult =
  | { ok: true; punch: TimePunch }
  | { ok: false; code: EditPunchCode };

/**
 * Change a punch's times. Stamps `adminEditedAt` so a crew member can see that
 * someone else moved their hours (§2.9.8) — `origin` is left alone, because who
 * CREATED a punch and who last edited it are different facts.
 *
 * **The day is immutable** (`day_moved`). A punch belongs to the vessel-local day its
 * `inAt` falls on: that's what buckets it into a pay period and what its `shiftId` was
 * auto-matched against. There is no date field on the edit form — but times alone can
 * cross midnight (23:50 → 00:10 is twenty minutes and a different day), so the rule is
 * enforced here rather than assumed from the form's shape. Moving a punch to another
 * day is delete + add: explicit, and it re-matches the shift on the way in.
 *
 * `outAt` may cross midnight freely — a night shift is one punch, and only `inAt`
 * decides which day it belongs to.
 */
export async function editPunch(
  repo: Repository,
  id: TimePunchId,
  patch: {
    inAt?: Date;
    outAt?: Date | null;
    now: Date;
    /**
     * Who is editing. Defaults to `"admin"`, which stamps `adminEditedAt`. **A `"crew"`
     * edit leaves that flag alone**: it exists so a crew member can see that SOMEONE
     * ELSE moved their hours, and setting it on their own correction would make the
     * surface lie about who did it. Passed in rather than fixed up afterwards so the
     * punch is written once — a second corrective write is a window where the row is
     * saved with the wrong provenance and no trail row exists yet (#635 review).
     */
    actor?: TimePunchOrigin;
  },
): Promise<EditPunchResult> {
  const existing = await repo.getTimePunch(id);
  if (!existing) return { ok: false, code: "gone" };

  const inAt = patch.inAt === undefined ? existing.inAt : patch.inAt.toISOString();
  const outAt =
    patch.outAt === undefined
      ? existing.outAt
      : patch.outAt === null
        ? null
        : patch.outAt.toISOString();

  if (vesselDateOf(new Date(inAt)) !== vesselDateOf(new Date(existing.inAt))) {
    return { ok: false, code: "day_moved" };
  }
  if (!spanIsValid(inAt, outAt)) return { ok: false, code: "out_before_in" };
  if (inTheFuture(inAt, patch.now) || inTheFuture(outAt, patch.now)) {
    return { ok: false, code: "future" };
  }

  const edited: TimePunch = {
    ...existing,
    inAt,
    outAt,
    adminEditedAt:
      (patch.actor ?? "admin") === "crew"
        ? existing.adminEditedAt
        : patch.now.toISOString(),
  };

  try {
    await repo.saveTimePunch(edited);
  } catch (err) {
    // Re-opening a punch (clearing `outAt`) for someone already on the clock.
    if (isUniqueViolation(err)) return { ok: false, code: "already_in" };
    throw err;
  }
  return { ok: true, punch: edited };
}

/**
 * Delete a punch outright. **Real deletion, not a flag** — the surface says so before
 * calling this (#627 AC). Idempotent at the adapter, so a double-submitted delete is a
 * no-op rather than an error.
 */
export async function deletePunch(repo: Repository, id: TimePunchId): Promise<void> {
  await repo.removeTimePunch(id);
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
