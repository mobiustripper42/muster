/**
 * Thread membership — derived, not snapshotted (#111, DEC-051).
 *
 * A pure function over data already in hand. The standing kinds compute their
 * members from the live schedule + roster, so membership can never lie the way a
 * saved cohort would the moment a shift moves (the Xola-trap calendar, DEC-009
 * spirit). Only DMs carry persisted membership.
 *
 *   - **shift**     → the assigned crew on that shift's seats
 *   - **cohort**    → the assigned crew across EVERY shift that day (all vessels)
 *   - **all_staff** → the roster as given
 *   - **dm**        → the persisted participant rows
 *
 * Dispatch is a **registry keyed by `thread.kind`** — data, not a hardcoded
 * branch (DEC-051 / DEC-ROLE-1). Adding a kind is a new entry + resolver, never
 * surgery on a god-switch.
 */

import type { CrewMember, Seat, Shift } from "../domain/entities.js";
import type { CrewMemberId } from "../domain/ids.js";
import type { Participant, Thread, ThreadKind } from "./entities.js";

/**
 * Everything a resolver might read. The caller passes what it has — the standing
 * kinds want shifts/seats/roster; DM wants the thread's persisted participants.
 * `roster` is the universe all-staff resolves to; pass active-only if the surface
 * wants to exclude inactive crew (the deriver imposes no such policy — it returns
 * exactly who it's given).
 */
export interface MembershipContext {
  /** Shifts in scope — cohort filters by day; shift selects by id. */
  shifts: Shift[];
  /** Seats whose `assignedCrewMemberId` is the membership for the derived kinds. */
  seats: Seat[];
  /** The roster — all_staff membership. */
  roster: CrewMember[];
  /** The thread's persisted DM participants (empty for the derived kinds). */
  participants: Participant[];
}

type Resolver = (thread: Thread, ctx: MembershipContext) => CrewMemberId[];

const uniq = (ids: CrewMemberId[]): CrewMemberId[] => [...new Set(ids)];

/** Assigned crew on the seats matching `pick`, de-duped, first-seen order. */
const assignedOn = (
  seats: Seat[],
  pick: (s: Seat) => boolean,
): CrewMemberId[] =>
  uniq(
    seats
      .filter(pick)
      .map((s) => s.assignedCrewMemberId)
      .filter((id): id is CrewMemberId => id !== undefined),
  );

const RESOLVERS: Record<ThreadKind, Resolver> = {
  shift: (thread, ctx) =>
    assignedOn(ctx.seats, (s) => String(s.shiftId) === thread.scopeRef),
  cohort: (thread, ctx) => {
    const dayShiftIds = new Set(
      ctx.shifts.filter((s) => s.date === thread.scopeRef).map((s) => String(s.id)),
    );
    return assignedOn(ctx.seats, (s) => dayShiftIds.has(String(s.shiftId)));
  },
  all_staff: (_thread, ctx) => uniq(ctx.roster.map((c) => c.id)),
  dm: (_thread, ctx) => uniq(ctx.participants.map((p) => p.crewMemberId)),
};

/**
 * The members of `thread`, computed from `ctx`. Pure — same inputs, same output,
 * no I/O, no clock. The caller fetches the inputs (cheap: bounded aggregates
 * already loaded) and persists nothing; membership is a read, every read.
 */
export function deriveMembers(
  thread: Thread,
  ctx: MembershipContext,
): CrewMemberId[] {
  return RESOLVERS[thread.kind](thread, ctx);
}
