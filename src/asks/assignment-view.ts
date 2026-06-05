/**
 * Assignment view (SPEC §2.4) — thin, in the `browse.ts` / `roster.ts` mold: a
 * structured `buildAssignmentView` plus a text `renderAssignmentView`. The real
 * cockpit UI is M4; this is the domain-core read model the loop is tested
 * against and the slice renders.
 *
 * One shift's seats: each card shows its sub-state + occupant; each Open seat
 * expands to the oracle's ranked eligible pool (§1.3/§1.4) with per-candidate ask
 * status. **`silent` is first-class and distinct from `declined`** (§2.4) — a
 * ghost that was asked and timed out must be obvious; silence is what Spink hates
 * and what the score penalizes.
 *
 * No "fills by" countdown here — that needs the staffing-horizon clock, which the
 * loop deliberately does without (DEC-019 scope note). It lands with the horizon.
 */

import type { Seat } from "../domain/entities.js";
import type { CrewMemberId, SeatId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { eligiblePool } from "../oracle/oracle.js";
import { rankPool } from "./ask-loop.js";

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
  /** Occupant name when Claimed/Confirmed. */
  occupant?: string;
  /** Ranked eligible pool — populated only for an Open seat. */
  pool?: PoolCandidateView[];
}

export interface AssignmentView {
  shiftId: ShiftId;
  vesselName: string;
  date: string;
  /** Overall crewing-state badge (Filling / Crewed / At-Risk / …). */
  badge: string;
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

export async function buildAssignmentView(
  repo: Repository,
  shiftId: ShiftId,
): Promise<AssignmentView | null> {
  const shift = await repo.getShift(shiftId);
  if (!shift) return null;
  const vessel = await repo.getVessel(shift.vesselId);
  const required = (await repo.listSeatsForShift(shiftId)).filter(
    (s) => s.kind === "required",
  );
  const pools = await eligiblePool(repo, shiftId);

  const seats: SeatCardView[] = [];
  for (const seat of required) {
    const card: SeatCardView = { seatId: seat.id, state: seat.state };
    if (seat.assignedCrewMemberId) {
      const crew = await repo.getCrewMember(seat.assignedCrewMemberId);
      if (crew) card.occupant = crew.name;
    }
    if (seat.state === "Open") {
      const eligibleIds = pools.find((p) => p.seatId === seat.id)?.eligible ?? [];
      const crew = (
        await Promise.all(eligibleIds.map((id) => repo.getCrewMember(id)))
      ).filter((c): c is NonNullable<typeof c> => c !== null);
      const ranked = rankPool(crew);
      const seatAsks = await repo.listAsksForSeat(seat.id); // once, not per candidate
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
    seats,
  };
}

/** Thin text render (slice-level; the cockpit UI is M4). */
export function renderAssignmentView(view: AssignmentView): string {
  const lines: string[] = [
    `${view.vesselName} — ${view.date}  [${view.badge}]`,
  ];
  for (const seat of view.seats) {
    if (seat.state === "Open") {
      lines.push(`  • seat ${seat.seatId}: Open`);
      for (const c of seat.pool ?? []) {
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
