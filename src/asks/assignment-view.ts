/**
 * Assignment view (SPEC §2.4) — the cockpit's read model: a structured
 * `buildAssignmentView` plus a text `renderAssignmentView`.
 *
 * One shift's seats: each card shows its sub-state + occupant; a seat that can
 * take or is taking asks (Open / Asked / Bailed) expands to the oracle's ranked
 * eligible pool (§1.3/§1.4) with per-candidate ask status. **`silent` is
 * first-class and distinct from `declined`** (§2.4) — a ghost that was asked and
 * timed out must be obvious; silence is what Eric hates and what the score
 * penalizes. A **Bailed** seat lists that shift's bailer as a non-actionable
 * `bailed`-status row (context — who walked) while still excluding them from the
 * re-ask everywhere (DEC-019): seen, never re-offered. The P3 gap where the
 * regression click-through showed less than the board is closed here (#54).
 *
 * Header facts for the cockpit (#54): trips + pax (booked only, like the shift
 * card), `tripStart`, the staffing `horizon` (DEC-022), and the `fillsBy`
 * deadline (DEC-031) — the named fill-deadline concept, now real (#59), bound to
 * the same constant the At-Risk board boards on, so the cockpit and the board
 * read the same instant.
 */

import type { Seat } from "../domain/entities.js";
import type { CrewMemberId, RoleTypeId, SeatId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import {
  earliestScheduledStart,
  fillDeadlineFromEvents,
  staffingHorizonFromEvents,
} from "../builder/derive.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";
import { rankedEligible } from "./ask-loop.js";

/** A candidate's ask status for one seat (§2.4 "ask status" vocabulary). */
export type CandidateAskStatus =
  | "available" // never asked
  | "asked" // ask out, awaiting response
  | "in" // accepted
  | "declined" // declined (neutral)
  | "silent" // asked, timed out — the ghost, distinct from declined
  | "bailed"; // bailed off this seat — listed for context, never re-asked (DEC-019)

export interface PoolCandidateView {
  crewMemberId: CrewMemberId;
  name: string;
  status: CandidateAskStatus;
  /** Response latency in ms, when they answered (accepted/declined). */
  replyMs?: number;
}

export interface SeatCardView {
  seatId: SeatId;
  state: Seat["state"];
  /** The role this seat demands (DEC-ROLE-1 reference, never an enum). */
  role: RoleTypeId;
  /** Display name for `role` — resolved once here so the page needn't re-join. */
  roleName: string;
  /** Occupant name when Claimed/Confirmed. */
  occupant?: string;
  /**
   * Ranked eligible pool — populated for Open, Asked and Bailed seats (an Asked
   * seat's pool is the monitor view: who's in flight, who went silent). Bailed
   * pools exclude that shift's bailers (DEC-019).
   */
  pool?: PoolCandidateView[];
}

/** One scheduled trip's header facts (booked pax only, like the shift card). */
export interface TripView {
  /** Departure clock time, e.g. "14:00". */
  departureTime: string;
  pax: number;
}

export interface AssignmentView {
  shiftId: ShiftId;
  vesselName: string;
  date: string;
  /** Overall crewing-state badge (Filling / Crewed / At-Risk / …). */
  badge: string;
  /** Scheduled trips, earliest first. */
  trips: TripView[];
  /** Total booked pax across all trips. */
  paxTotal: number;
  /** Earliest scheduled departure; null when no event anchors the shift. */
  tripStart: Date | null;
  /** The staffing horizon (DEC-022) — when asks start, NOT a fill deadline. */
  horizon: Date | null;
  /**
   * The "fills by" deadline (DEC-031): `tripStart − FILL_DEADLINE_HOURS`, the
   * instant this shift becomes a human problem. `null` when no event anchors the
   * shift; may be past (render as overdue, not clamped).
   */
  fillsBy: Date | null;
  seats: SeatCardView[];
}

/** Derive a candidate's ask status for a seat from their asks on it. */
function statusFromAsks(
  asks: { respondedAt?: string; response?: string; sentAt: string }[],
): { status: CandidateAskStatus; replyMs?: number } {
  if (asks.length === 0) return { status: "available" };
  // Most recent ask wins (re-asks supersede).
  const latest = [...asks].sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1))[0]!;
  if (latest.response === "accepted") {
    return {
      status: "in",
      replyMs: new Date(latest.respondedAt!).getTime() - new Date(latest.sentAt).getTime(),
    };
  }
  if (latest.response === "declined") {
    return {
      status: "declined",
      replyMs: new Date(latest.respondedAt!).getTime() - new Date(latest.sentAt).getTime(),
    };
  }
  // Withdrawn (#600): the seat was filled while this ask was out, so it was retired
  // unanswered. They read **available**, not `silent` — this is the exact row the
  // issue was raised about ("the cockpit renders all five as 👻 silent — no reply,
  // timed out"). They never ghosted anything, `askedSetFrom` no longer excludes them
  // from a re-ask, and the operator should get the assign affordance rather than the
  // nudge-a-ghoster one. The fact that they WERE asked is not lost — it lives in the
  // ask trail, whose job is history; this field's job is "can I use this person".
  if (latest.response === "withdrawn") return { status: "available" };
  // respondedAt set but no response = timed out (expireAsks stamp) → silent.
  if (latest.respondedAt !== undefined) return { status: "silent" };
  return { status: "asked" };
}

/** Seat states whose card expands to the candidate pool (§2.4 + the P3 fix). */
const POOLED_STATES: ReadonlySet<Seat["state"]> = new Set([
  "Open",
  "Asked",
  "Bailed",
]);

// REFACTOR QUEUE — cognitive complexity 63, against a ceiling of 40 (#909).
// Baselined, NOT accepted: this is on the list in the tracking issue. The ceiling
// ratchets down as the list shrinks, so this disable is meant to be deleted.
// eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing, score 63
export async function buildAssignmentView(
  repo: Repository,
  shiftId: ShiftId,
  now: Date,
  tz: string = TENANT_TIMEZONE,
): Promise<AssignmentView | null> {
  const shift = await repo.getShift(shiftId);
  if (!shift) return null;
  const vessel = await repo.getVessel(shift.vesselId);
  const required = (await repo.listSeatsForShift(shiftId)).filter(
    (s) => s.kind === "required",
  );
  const roleNames = new Map(
    (await repo.listAllRoleTypes()).map((r) => [r.id, r.name]),
  );

  // Header facts: scheduled trips + booked pax, and the two time anchors.
  const events = [];
  for (const eventId of shift.eventIds) {
    const event = await repo.getEvent(eventId);
    if (event) events.push(event);
  }
  const trips: TripView[] = [];
  for (const event of events) {
    if (event.status !== "scheduled") continue;
    const booked = (await repo.listReservationsForEvent(event.id)).filter(
      (r) => r.status === "booked",
    );
    trips.push({
      departureTime: event.time,
      pax: booked.reduce((sum, r) => sum + r.partySize, 0),
    });
  }
  trips.sort((a, b) => a.departureTime.localeCompare(b.departureTime));

  // The actions' accept set is SHIFT-wide (lean/assignFromPool, DEC-026/027):
  // bailers and live-ask holders are refused everywhere on the shift. The view
  // must not render what the action refuses — nor a bailer's stale "accepted"
  // as *said yes* on the seat they walked off. So: exclude this shift's bailers
  // from EVERY pool, and live-ask holders from every pool EXCEPT the seat their
  // ask is on (there they stay visible as `asked` — the monitor view).
  const hasPooledSeat = required.some((s) => POOLED_STATES.has(s.state));
  const bailers = new Set<CrewMemberId>();
  // Which seat each bailer walked off (shift_bailed.seatId) — a Bailed seat
  // lists its own bailer as context (#3.3); excluded from the re-ask regardless.
  const bailersBySeat = new Map<string, CrewMemberId[]>();
  if (hasPooledSeat) {
    // Crew-keyed log walk — same pattern + M4-index revisit as the board's.
    for (const crew of await repo.listCrewMembers()) {
      const log = await repo.reliabilityEventsFor(crew.id);
      for (const e of log) {
        if (e.type !== "shift_bailed" || e.metadata.shiftId !== shiftId) continue;
        bailers.add(crew.id);
        const seatKey = e.metadata.seatId ? String(e.metadata.seatId) : null;
        if (seatKey) {
          const arr = bailersBySeat.get(seatKey) ?? [];
          if (!arr.includes(crew.id)) arr.push(crew.id);
          bailersBySeat.set(seatKey, arr);
        }
      }
    }
  }
  const asksBySeat = new Map(
    await Promise.all(
      required.map(
        async (s) => [String(s.id), await repo.listAsksForSeat(s.id)] as const,
      ),
    ),
  );
  const liveAskSeatOf = new Map<CrewMemberId, Set<string>>();
  for (const [seatKey, asks] of asksBySeat) {
    for (const ask of asks) {
      if (ask.respondedAt !== undefined) continue;
      const seats = liveAskSeatOf.get(ask.crewMemberId) ?? new Set<string>();
      seats.add(seatKey);
      liveAskSeatOf.set(ask.crewMemberId, seats);
    }
  }

  const seats: SeatCardView[] = [];
  for (const seat of required) {
    const card: SeatCardView = {
      seatId: seat.id,
      state: seat.state,
      role: seat.role,
      roleName: roleNames.get(seat.role) ?? String(seat.role),
    };
    if (seat.assignedCrewMemberId) {
      const crew = await repo.getCrewMember(seat.assignedCrewMemberId);
      if (crew) card.occupant = crew.name;
    }
    if (POOLED_STATES.has(seat.state)) {
      const exclude = new Set<CrewMemberId>(bailers);
      for (const [crewId, askSeats] of liveAskSeatOf) {
        if (!askSeats.has(String(seat.id))) exclude.add(crewId);
      }
      // rankedEligible (not raw eligiblePool) so the view also applies the
      // intra-shift distinct-pool exclusion the actions do.
      const ranked = await rankedEligible(repo, seat, now, exclude);
      const seatAsks = asksBySeat.get(String(seat.id)) ?? [];
      card.pool = ranked.map((c) => {
        const asks = seatAsks.filter((a) => a.crewMemberId === c.id);
        const { status, replyMs } = statusFromAsks(asks);
        return {
          crewMemberId: c.id,
          name: c.name,
          status,
          ...(replyMs !== undefined ? { replyMs } : {}),
        };
      });
      // A Bailed seat lists its own bailer(s) first, status `bailed`, no action
      // (the re-ask refuses them — DEC-019); they're seen, never re-offered.
      if (seat.state === "Bailed") {
        const bailed: PoolCandidateView[] = [];
        for (const crewId of bailersBySeat.get(String(seat.id)) ?? []) {
          const crew = await repo.getCrewMember(crewId);
          if (crew) bailed.push({ crewMemberId: crewId, name: crew.name, status: "bailed" });
        }
        card.pool = [...bailed, ...card.pool];
      }
    }
    seats.push(card);
  }

  return {
    shiftId,
    vesselName: vessel?.name ?? "(unknown vessel)",
    date: shift.date,
    badge: shift.state,
    trips,
    paxTotal: trips.reduce((sum, t) => sum + t.pax, 0),
    tripStart: earliestScheduledStart(events, tz),
    horizon: staffingHorizonFromEvents(events, undefined, tz),
    fillsBy: fillDeadlineFromEvents(events, undefined, tz),
    seats,
  };
}

/** Thin text render (slice-level; the cockpit UI is M4). */
export function renderAssignmentView(view: AssignmentView): string {
  const lines: string[] = [
    `${view.vesselName} — ${view.date}  [${view.badge}]`,
  ];
  for (const seat of view.seats) {
    if (seat.pool !== undefined) {
      lines.push(`  • seat ${seat.seatId}: ${seat.state}`);
      for (const c of seat.pool) {
        const reply = c.replyMs !== undefined ? ` (${Math.round(c.replyMs / 1000)}s)` : "";
        lines.push(`      - ${c.name}: ${c.status}${reply}`);
      }
    } else {
      const who = seat.occupant ? ` — ${seat.occupant}` : "";
      lines.push(`  • seat ${seat.seatId}: ${seat.state}${who}`);
    }
  }
  return lines.join("\n");
}
