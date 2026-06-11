/**
 * Assignment view (SPEC §2.4) — the cockpit's read model: a structured
 * `buildAssignmentView` plus a text `renderAssignmentView`.
 *
 * One shift's seats: each card shows its sub-state + occupant; a seat that can
 * take or is taking asks (Open / Asked / Bailed) expands to the oracle's ranked
 * eligible pool (§1.3/§1.4) with per-candidate ask status. **`silent` is
 * first-class and distinct from `declined`** (§2.4) — a ghost that was asked and
 * timed out must be obvious; silence is what Spink hates and what the score
 * penalizes. A **Bailed** seat's pool excludes that shift's bailers (the re-ask's
 * own exclusion, DEC-019) — the P3 gap where the regression click-through showed
 * less than the board is closed here (#54).
 *
 * Header facts for the cockpit (#54): trips + pax (booked only, like the shift
 * card), `tripStart` and the staffing `horizon` (DEC-022) — both **facts**, not a
 * "fills by" deadline. The named fill-deadline concept is deliberately NOT faked
 * here; it lands with #59 (DEC-027 §4).
 */

import type { Seat } from "../domain/entities.js";
import type { CrewMemberId, RoleTypeId, SeatId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import {
  earliestScheduledStart,
  staffingHorizonFromEvents,
} from "../builder/derive.js";
import { rankedEligible } from "./ask-loop.js";

/** A candidate's ask status for one seat (§2.4 "ask status" vocabulary). */
export type CandidateAskStatus =
  | "available" // never asked
  | "asked" // ask out, awaiting response
  | "in" // accepted
  | "declined" // declined (neutral)
  | "silent"; // asked, timed out — the ghost, distinct from declined

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

export async function buildAssignmentView(
  repo: Repository,
  shiftId: ShiftId,
  now: Date,
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
  if (hasPooledSeat) {
    // Crew-keyed log walk — same pattern + M4-index revisit as the board's.
    for (const crew of await repo.listCrewMembers()) {
      const log = await repo.reliabilityEventsFor(crew.id);
      if (
        log.some(
          (e) => e.type === "shift_bailed" && e.metadata.shiftId === shiftId,
        )
      ) {
        bailers.add(crew.id);
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
    tripStart: earliestScheduledStart(events),
    horizon: staffingHorizonFromEvents(events),
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
