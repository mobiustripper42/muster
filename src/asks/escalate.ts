/**
 * Tier-2 escalation — the mechanism (DEC-024, SPEC §1.2 Tier 2).
 *
 * When Tier-1 stalls (a `Filling` shift with `Open` required seats and no live
 * asks — the broadcast went out and came back declined-or-silent), `tick` calls
 * `escalate`. Two moves, both within `Filling`, no Spink:
 *
 *   1. **Widen-stub** (`logPoolWidened`): every eligibility rule is hard and the
 *      Tier-1 broadcast already reached the whole pool, so there is nothing left
 *      to relax — this records that the engine re-checked, it widens nothing.
 *   2. **Direct-nudge** the top-ranked eligible crew who **ghosted** the broadcast:
 *      an `assignPerson` (assign-then-confirm) + `logNudged`. The pointed "I need
 *      you on this" to someone who let the broadcast time out.
 *
 * Who is a candidate (DEC-024): eligible for the seat, **minus** anyone already
 * committed on the shift (distinct-pool, DEC-003), anyone who **declined** it (they
 * said no — don't poke again), anyone with a **live** ask (mid-flight), and anyone
 * **already nudged** for this shift on a prior tick. That last exclusion is what
 * makes escalation **terminate**: each person is nudged at most once, so once the
 * candidates run dry `escalate` only logs the widen-stub and the shift rides its
 * horizon to At-Risk (Tier 3). No `escalation_accepted` bonus is awarded — every
 * target is by construction a Tier-1 ghoster, and rewarding a late yes after an
 * ignored broadcast is backwards (DEC-024 amendment).
 *
 * Pure-ish over the port like the rest of the loop: `now` injected, no clock read.
 */

import type { CrewMemberId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { eligiblePool } from "../oracle/oracle.js";
import { rankEligibleIds } from "../oracle/reliability-score.js";
import { logNudged, logPoolWidened } from "../oracle/reliability-log.js";
import { assignPerson } from "./ask-loop.js";

export interface EscalateResult {
  /** Whether the widen-stub fired (false only if the shift wasn't escalable). */
  widened: boolean;
  /** Crew newly nudged this call, in seat order. */
  nudged: CrewMemberId[];
}

/**
 * Run Tier-2 on one stalled shift. Idempotent across ticks by construction: a
 * person nudged once is excluded thereafter, so re-entry only nudges newly-stalled
 * seats and never re-pokes the same person.
 */
export async function escalate(
  repo: Repository,
  shiftId: ShiftId,
  now: Date,
): Promise<EscalateResult> {
  const shift = await repo.getShift(shiftId);
  if (!shift || shift.state !== "Filling") return { widened: false, nudged: [] };

  const required = (await repo.listSeatsForShift(shiftId)).filter(
    (s) => s.kind === "required",
  );
  const openSeats = required.filter((s) => s.state === "Open");
  if (openSeats.length === 0) return { widened: false, nudged: [] };

  // Widen-stub: the engine re-confirmed full-pool exhaustion (DEC-024). Logged
  // even when no one is nudgeable — "pool widened · exhausted" is a real trail rung.
  await logPoolWidened(repo, shiftId, now);

  // ── Build the no-nudge set ──────────────────────────────────────────────────
  const excluded = new Set<CrewMemberId>();
  // Committed on this shift (Claimed/Confirmed) — can't double-book (DEC-003).
  for (const s of required) {
    if (
      (s.state === "Claimed" || s.state === "Confirmed") &&
      s.assignedCrewMemberId
    ) {
      excluded.add(s.assignedCrewMemberId);
    }
  }
  // Declined (said no) or mid-flight (live, unanswered ask) — leave them be.
  // Silent (timed out: respondedAt set, no response) are NOT excluded — they're
  // the ghosters this whole mechanism exists to poke.
  for (const s of required) {
    for (const ask of await repo.listAsksForSeat(s.id)) {
      if (ask.response === "declined" || ask.respondedAt === undefined) {
        excluded.add(ask.crewMemberId);
      }
    }
  }
  // Already nudged for this shift (prior ticks) — at most one nudge per person.
  for (const c of await repo.listCrewMembers()) {
    const events = await repo.reliabilityEventsFor(c.id);
    if (events.some((e) => e.type === "nudged" && e.metadata.shiftId === shiftId)) {
      excluded.add(c.id);
    }
  }

  // ── Nudge the top-ranked survivor per open seat ─────────────────────────────
  const pools = await eligiblePool(repo, shiftId);
  const nudged: CrewMemberId[] = [];
  for (const seat of openSeats) {
    const pool = pools.find((p) => p.seatId === seat.id);
    if (!pool) continue;
    const candidates = pool.eligible.filter((id) => !excluded.has(id));
    if (candidates.length === 0) continue;
    const [pick] = await rankEligibleIds(repo, candidates, now);
    if (!pick) continue;
    const ask = await assignPerson(repo, seat.id, pick.id, now);
    if (!ask) continue; // seat wasn't Open after all — skip defensively
    await logNudged(repo, pick.id, seat.id, shiftId, now);
    excluded.add(pick.id); // distinct-pool: don't nudge one person into two seats
    nudged.push(pick.id);
  }

  return { widened: true, nudged };
}
