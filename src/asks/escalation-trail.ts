/**
 * The escalation trail — a derived read-model of how hard the engine worked a
 * shift (DEC-024, SPEC §2.5).
 *
 * The At-Risk board's transparency string ("asked 6 mates · 4 declined · 2 silent
 * · pool widened · nudged Bob · exhausted") is proof the automation tried before
 * it gave up. That proof is **derived, not stored**: there is no escalation
 * aggregate. This projection reconstructs the trail for one shift from data that
 * already exists —
 *   - asked / accepted / declined / silent / withdrawn  ← the seats' asks
 *     (`listAsksForSeat`),
 *     which already carry `response` + `respondedAt`;
 *   - pool-widened / nudged                 ← the two Tier-2 actions on the one
 *     append-only reliability log (DEC-008), filtered by `metadata.shiftId`;
 *   - exhausted                             ← the oracle's distinct-pool solve.
 *
 * Pure over the port: it calls only existing read methods, so it behaves
 * identically on the in-memory and Postgres adapters — no new port method, no
 * DDL, no second log to keep consistent.
 *
 * #40b's `escalate()` is what *emits* `pool_widened` / `nudged`; this is the
 * reader #41's board consumes. Per DEC-008 the reader is built and tested now,
 * before its writer exists — the trail is real from the first commit.
 *
 * Scale note (same revisit trigger as DEC-022's stored-horizon): the `nudged`
 * scan walks every crew member's log because the reliability log is crew-keyed
 * and there is no events-by-shift port read. Cheap at BrewBoat's roster size;
 * if the board ever sorts at DB scale, add an indexed read then.
 */

import type { CrewMemberId, ShiftId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { SYSTEM_ACTOR_ID } from "../oracle/reliability-log.js";
import { solveShift } from "../oracle/oracle.js";

/** The reconstructed escalation trail for one shift — the board's raw numbers. */
export interface EscalationTrail {
  shiftId: ShiftId;
  /** Total asks fired across the shift's required seats (re-asks included). */
  asked: number;
  /** Asks that won a yes (`response === "accepted"`). */
  accepted: number;
  /** Asks answered with a no — neutral (`response === "declined"`). */
  declined: number;
  /** Asks that timed out unanswered — the negative signal (stamped, no response). */
  silent: number;
  /**
   * Asks retired unanswered because the seat got filled (#600) — `response ===
   * "withdrawn"`. Its own bucket, NOT folded into `silent`: this surface exists to
   * prove the automation tried, and reporting five people as ghosts when the seat was
   * taken 51 seconds after they were asked is the opposite of proof. `asked` still
   * counts them — we did ask.
   */
  withdrawn: number;
  /** Asks still live: no response and not yet timed out. */
  pending: number;
  /** Tier-2 re-confirmed full-pool exhaustion at least once (the v1 stub). */
  poolWidened: boolean;
  /**
   * Crew directly nudged on this shift, earliest-nudge first. A **distinct-crew
   * set** (not a per-event count): a re-nudge of the same person appears once, so
   * `nudged.length` is people nudged, not nudge actions.
   */
  nudged: CrewMemberId[];
  /** The oracle cannot crew every required seat from the pool as of `now`. */
  exhausted: boolean;
}

/**
 * Reconstruct the escalation trail for `shiftId` as of `now`. `now` is the
 * scoring instant for the exhaustion solve (the only clock-sensitive part);
 * everything else is a fold over already-logged facts.
 */
export async function escalationTrailFor(
  repo: Repository,
  shiftId: ShiftId,
  now: Date,
): Promise<EscalationTrail> {
  const trail: EscalationTrail = {
    shiftId,
    asked: 0,
    accepted: 0,
    declined: 0,
    silent: 0,
    withdrawn: 0,
    pending: 0,
    poolWidened: false,
    nudged: [],
    exhausted: false,
  };

  // ── asked / accepted / declined / silent / pending — from the seats' asks ──
  // Required seats only: supernumerary seats don't gate crewing (DEC-005), so
  // their asks aren't part of "did we work this shift hard enough".
  const seats = (await repo.listSeatsForShift(shiftId)).filter(
    (s) => s.kind === "required",
  );
  for (const seat of seats) {
    for (const ask of await repo.listAsksForSeat(seat.id)) {
      trail.asked++;
      if (ask.response === "accepted") trail.accepted++;
      else if (ask.response === "declined") trail.declined++;
      else if (ask.response === "withdrawn") trail.withdrawn++; // #600 — seat filled
      else if (ask.respondedAt !== undefined)
        trail.silent++; // stamped without a response = timed out (expireAsks)
      else trail.pending++;
    }
  }

  // ── pool-widened — the shift-level stub, keyed to the system actor ──────────
  const systemEvents = await repo.reliabilityEventsFor(SYSTEM_ACTOR_ID);
  trail.poolWidened = systemEvents.some(
    (e) => e.type === "pool_widened" && e.metadata.shiftId === shiftId,
  );

  // ── nudged — crew-keyed, so scan the roster's logs for this shift ───────────
  // Sort by the (earliest) nudge timestamp so the order is the trail's log order,
  // deterministic across adapters — not the unspecified `listCrewMembers` order.
  const nudges: { id: CrewMemberId; at: string }[] = [];
  for (const crew of await repo.listCrewMembers()) {
    const events = await repo.reliabilityEventsFor(crew.id);
    const first = events
      .filter((e) => e.type === "nudged" && e.metadata.shiftId === shiftId)
      .reduce<string | undefined>(
        (min, e) => (min === undefined || e.timestamp < min ? e.timestamp : min),
        undefined,
      );
    if (first !== undefined) nudges.push({ id: crew.id, at: first });
  }
  trail.nudged = nudges.sort((a, b) => a.at.localeCompare(b.at)).map((n) => n.id);

  // ── exhausted — the oracle's distinct-pool verdict (DEC-003) ────────────────
  const solution = await solveShift(repo, shiftId, now);
  trail.exhausted = !solution.satisfiable;

  return trail;
}
