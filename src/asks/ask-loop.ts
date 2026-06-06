/**
 * The Tier-1 ask/confirm loop (SPEC §1.2 Tier 1, §2.4, DEC-005, DEC-007,
 * DEC-019).
 *
 * The seat-machine kernel: thin, repo-backed use-cases that move a seat
 * `Open → Asked → Claimed → Confirmed` and handle the off-happy edges (decline,
 * timeout, bail, manual override). No transport, no scheduler, no clock read —
 * `now` is always injected. A real channel adapter (DEC-MSG-3) funnels into the
 * same `recordResponse` at M4; the loop never talks to it.
 *
 * Two protocols ride this one machine (DEC-007): **ask-then-assign** (broadcast
 * to the ranked pool, first acceptable yes wins) and **assign-then-confirm**
 * (name one person, they confirm/decline). They differ only in the *entry* —
 * `broadcastAsk` vs `assignPerson` — then share every edge.
 *
 * Horizon-agnostic by design (DEC-019 scope note): the loop works the seats it is
 * handed, when called, like the oracle. The early-vs-late-bail → Filling-vs-AtRisk
 * split needs the staffing-horizon clock and is left to that task.
 */

import type { Ask, CrewMember, Seat } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { AskId, CrewMemberId, SeatId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { deriveShiftState } from "../builder/derive.js";
import { eligiblePool } from "../oracle/oracle.js";
import {
  logAskAccepted,
  logAskDeclined,
  logAskIgnored,
  logAskSent,
  logShiftBailed,
} from "../oracle/reliability-log.js";

/** Default channel for a domain-core ask; the real adapter sets this at M4. */
const DEFAULT_CHANNEL = "push" as const;

/**
 * Neutral, stable pool ranking — the single Phase-2 insertion point for real
 * reliability ordering (§1.4). Today the score is null/flat (DEC-008), so this
 * orders by score-if-present (desc) and tie-breaks by id (asc) so the loop and
 * its tests are deterministic. Replace the comparator here when the scorer lands;
 * nothing else in the loop knows about ranking.
 */
export function rankPool(crew: CrewMember[]): CrewMember[] {
  return [...crew].sort((a, b) => {
    const sa = a.reliabilityScore ?? 0;
    const sb = b.reliabilityScore ?? 0;
    if (sa !== sb) return sb - sa;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Re-derive and persist a shift's state after a seat change (keeps the badge true). */
async function refreshShiftState(
  repo: Repository,
  shiftId: Seat["shiftId"],
): Promise<void> {
  const shift = await repo.getShift(shiftId);
  if (!shift) return;
  const seats = await repo.listSeatsForShift(shiftId);
  await repo.saveShift({ ...shift, state: deriveShiftState(seats) });
}

/** Mint an ask for one candidate, set the seat Asked, log `ask_sent`. */
async function fireAsk(
  repo: Repository,
  seat: Seat,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<Ask> {
  const sentAt = now.toISOString();
  // Deterministic id (codebase convention). Uniqueness assumes one ask per
  // seat+crew+instant; a same-millisecond re-ask would collide and overwrite. The
  // assignment view's "most recent ask wins" relies on re-asks being distinct
  // rows — add a re-ask disambiguator when the durable store lands at M4.
  const ask: Ask = {
    id: asId<"AskId">(`ask-${seat.id}-${crewMemberId}-${sentAt}`),
    seatId: seat.id,
    crewMemberId,
    channel: DEFAULT_CHANNEL,
    sentAt,
  };
  await repo.saveAsk(ask);
  await logAskSent(repo, crewMemberId, seat.id, seat.shiftId, now);
  return ask;
}

/**
 * Crew already committed (Claimed/Confirmed) to *another* seat on the same shift.
 * `eligiblePool` excludes the current shift from its cross-shift double-booking
 * check (oracle.ts), so it cannot see intra-shift contention — one person can't
 * be both captain and mate on the same boat the same day (DEC-003's shared-pool
 * invariant). The loop enforces it here: exclude these crew from a seat's asks
 * and reject a claim that would double-book within the shift. BrewBoat's vessels
 * are all 2-crew, so this is the common shape, not an edge.
 */
async function committedOnShift(
  repo: Repository,
  shiftId: Seat["shiftId"],
  excludeSeatId: SeatId,
): Promise<Set<CrewMemberId>> {
  const seats = await repo.listSeatsForShift(shiftId);
  const held = new Set<CrewMemberId>();
  for (const s of seats) {
    if (s.id === excludeSeatId) continue;
    if (!s.assignedCrewMemberId) continue;
    if (s.state === "Claimed" || s.state === "Confirmed") {
      held.add(s.assignedCrewMemberId);
    }
  }
  return held;
}

/** The eligible crew for a seat, ranked, optionally excluding ids (e.g. a bailer). */
async function rankedEligible(
  repo: Repository,
  seat: Seat,
  exclude: ReadonlySet<CrewMemberId> = new Set(),
): Promise<CrewMember[]> {
  const pools = await eligiblePool(repo, seat.shiftId);
  const pool = pools.find((p) => p.seatId === seat.id);
  if (!pool) return [];
  // Also exclude anyone already holding another seat on this same shift.
  const onShift = await committedOnShift(repo, seat.shiftId, seat.id);
  const crew = (
    await Promise.all(
      pool.eligible
        .filter((id) => !exclude.has(id) && !onShift.has(id))
        .map((id) => repo.getCrewMember(id)),
    )
  ).filter((c): c is CrewMember => c !== null);
  return rankPool(crew);
}

// ── Entry: the two protocols ────────────────────────────────────────────────

/**
 * Ask-then-assign (mate flow): broadcast to the whole ranked eligible pool. The
 * seat goes `Open → Asked`; yeses accrue and the first acceptable one wins
 * (`recordResponse`). Returns the asks fired (empty → no eligible pool: the
 * caller escalates).
 */
export async function broadcastAsk(
  repo: Repository,
  seatId: SeatId,
  now: Date,
): Promise<Ask[]> {
  const seat = await repo.getSeat(seatId);
  if (!seat || seat.state !== "Open") return [];
  const pool = await rankedEligible(repo, seat);
  if (pool.length === 0) return [];
  await repo.saveSeat({ ...seat, state: "Asked" });
  const asks = await Promise.all(
    pool.map((c) => fireAsk(repo, seat, c.id, now)),
  );
  await refreshShiftState(repo, seat.shiftId);
  return asks;
}

/**
 * Assign-then-confirm (captain flow): name one person into the seat. The seat
 * goes `Open → Asked` with a single ask; their accept confirms, their decline
 * kicks back to `Open` for the next name. No eligibility gate is re-checked here
 * beyond what the caller did — Spink names whom he names; `manualOverride` is the
 * harder backstop. Returns the ask, or null if the seat wasn't open.
 */
export async function assignPerson(
  repo: Repository,
  seatId: SeatId,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<Ask | null> {
  const seat = await repo.getSeat(seatId);
  if (!seat || seat.state !== "Open") return null;
  await repo.saveSeat({ ...seat, state: "Asked" });
  const ask = await fireAsk(repo, seat, crewMemberId, now);
  await refreshShiftState(repo, seat.shiftId);
  return ask;
}

// ── Responses ───────────────────────────────────────────────────────────────

export interface ResponseOutcome {
  /** True iff this accept claimed the seat (first-acceptable-yes-wins, DEC-007). */
  claimed: boolean;
  /**
   * Why an accept did not claim:
   *  - `already_filled` — another candidate won this seat first (contested).
   *  - `double_booked` — the accepter already holds another seat on this shift
   *    (DEC-003 shared-pool: can't be two crew on one boat the same day).
   */
  reason?: "already_filled" | "double_booked";
  /** The seat's state after the response. */
  seatState: Seat["state"];
}

/**
 * Record a crew member's response to an ask. Logs the reliability event always
 * (their responsiveness counts even on a contested loss); mutates the seat only
 * on a winning accept.
 *
 * **Accept** → `logAskAccepted` (+latency). Confirm-iff-open guard, made atomic
 * via the port's `saveSeatIfState` compare-and-swap (REQ-CLAIM-1, DEC-020): the
 * `Asked → Claimed` write applies only if the seat is *still* `Asked`, so of two
 * simultaneous accepts only one wins the seat — the loser is a contested yes
 * (logged, `claimed:false, reason:"already_filled"`). The `seat.state==="Asked"`
 * pre-check just skips the work + double-book lookup for an already-settled seat;
 * the CAS is the actual race guard.
 * **Decline** → `logAskDeclined` (+latency, neutral). If that was the last open
 * ask and nobody claimed, the seat reopens to `Open` (all-declined edge).
 */
export async function recordResponse(
  repo: Repository,
  askId: AskId,
  response: "accepted" | "declined",
  now: Date,
): Promise<ResponseOutcome> {
  const ask = await repo.getAsk(askId);
  if (!ask) throw new Error(`no ask ${askId}`);
  const seat = await repo.getSeat(ask.seatId);
  if (!seat) throw new Error(`no seat ${ask.seatId}`);

  const latencyMs = now.getTime() - new Date(ask.sentAt).getTime();
  await repo.saveAsk({ ...ask, respondedAt: now.toISOString(), response });

  if (response === "accepted") {
    await logAskAccepted(
      repo,
      ask.crewMemberId,
      seat.id,
      seat.shiftId,
      now,
      latencyMs,
    );
    if (seat.state === "Asked") {
      // Shared-pool guard (DEC-003): can't claim if already on another seat here.
      const onShift = await committedOnShift(repo, seat.shiftId, seat.id);
      if (onShift.has(ask.crewMemberId)) {
        return { claimed: false, reason: "double_booked", seatState: seat.state };
      }
      // Atomic compare-and-swap (REQ-CLAIM-1): claim only if STILL Asked.
      const won = await repo.saveSeatIfState(
        { ...seat, state: "Claimed", assignedCrewMemberId: ask.crewMemberId },
        "Asked",
      );
      if (won) {
        await refreshShiftState(repo, seat.shiftId);
        return { claimed: true, seatState: "Claimed" };
      }
      // Lost the race between the read and the write — someone claimed first.
      const fresh = await repo.getSeat(seat.id);
      return {
        claimed: false,
        reason: "already_filled",
        seatState: fresh?.state ?? seat.state,
      };
    }
    // Contested: someone already claimed/confirmed this seat.
    return { claimed: false, reason: "already_filled", seatState: seat.state };
  }

  // Declined — neutral.
  await logAskDeclined(
    repo,
    ask.crewMemberId,
    seat.id,
    seat.shiftId,
    now,
    latencyMs,
  );
  if (seat.state === "Asked" && (await allAsksClosed(repo, seat.id))) {
    await repo.saveSeat({ ...seat, state: "Open" });
    await refreshShiftState(repo, seat.shiftId);
    return { claimed: false, seatState: "Open" };
  }
  return { claimed: false, seatState: seat.state };
}

/** Every ask on the seat has a response or has timed out (no live ask remains). */
async function allAsksClosed(repo: Repository, seatId: SeatId): Promise<boolean> {
  const asks = await repo.listAsksForSeat(seatId);
  // An ask is "closed" once it has a respondedAt (a real response OR a timeout
  // stamp — see expireAsks). A live, unanswered ask has no respondedAt.
  return asks.every((a) => a.respondedAt !== undefined);
}

/**
 * Confirm a claimant into the seat (`Claimed → Confirmed`) — Spink's confirm, or
 * the autonomous Tier-1 confirm of the first acceptable yes. Idempotent-safe: a
 * no-op unless the seat is `Claimed`.
 */
export async function confirmSeat(
  repo: Repository,
  seatId: SeatId,
  now: Date,
): Promise<Seat | null> {
  void now; // confirm logs no reliability event; now kept for signature symmetry
  const seat = await repo.getSeat(seatId);
  if (!seat || seat.state !== "Claimed") return null;
  const confirmed: Seat = { ...seat, state: "Confirmed" };
  await repo.saveSeat(confirmed);
  await refreshShiftState(repo, seat.shiftId);
  return confirmed;
}

// ── Timeout + bail + override ───────────────────────────────────────────────

/**
 * Close out asks that have gone silent past `timeoutMs` as of `now` — the
 * clockless `ask_ignored` use-case (DEC-MSG-3): no timer, the caller decides when
 * to sweep. Each timed-out, unanswered ask logs `ask_ignored` (the **negative**
 * one — silence, not a decline) and is stamped `respondedAt: now` with **no
 * `response`**, which marks it "timed out" (distinct from accepted/declined) and
 * makes the sweep idempotent. If that empties the seat's live asks and nobody
 * claimed, the seat reopens to `Open`.
 */
export async function expireAsks(
  repo: Repository,
  seatId: SeatId,
  now: Date,
  timeoutMs: number,
): Promise<number> {
  const seat = await repo.getSeat(seatId);
  if (!seat) return 0;
  const asks = await repo.listAsksForSeat(seatId);
  let expired = 0;
  for (const ask of asks) {
    if (ask.respondedAt !== undefined) continue;
    if (now.getTime() - new Date(ask.sentAt).getTime() < timeoutMs) continue;
    await logAskIgnored(repo, ask.crewMemberId, seatId, seat.shiftId, now);
    await repo.saveAsk({ ...ask, respondedAt: now.toISOString() });
    expired++;
  }
  if (
    expired > 0 &&
    seat.state === "Asked" &&
    (await allAsksClosed(repo, seatId))
  ) {
    await repo.saveSeat({ ...seat, state: "Open" });
    await refreshShiftState(repo, seat.shiftId);
  }
  return expired;
}

export interface BailOutcome {
  /** Asks fired to re-crew the seat (empty → pool exhausted → seat rests Bailed). */
  reAsks: Ask[];
  /** The seat's state after the bail: `Asked` if re-asked, else `Bailed`. */
  seatState: Seat["state"];
}

/**
 * A confirmed crew backs out (DEC-019): one atomic operation — log `shift_bailed`
 * (+`latenessMs`), drop the occupant, and re-ask the next candidates (excluding
 * the bailer). **If candidates exist the seat advances to `Asked`** and `Bailed`
 * is never a resting state (the happy path). **If the pool is exhausted the seat
 * rests at `Bailed`**, and `deriveShiftState` takes the shift to `AtRisk` — the
 * legitimate Tier-3 condition and the only AtRisk this clockless loop produces,
 * not a horizon artifact.
 */
export async function bail(
  repo: Repository,
  seatId: SeatId,
  now: Date,
  latenessMs: number,
): Promise<BailOutcome> {
  const seat = await repo.getSeat(seatId);
  if (!seat || seat.state !== "Confirmed" || !seat.assignedCrewMemberId) {
    throw new Error(`seat ${seatId} is not a confirmed seat to bail`);
  }
  const bailer = seat.assignedCrewMemberId;
  await logShiftBailed(repo, bailer, seat.shiftId, now, latenessMs, seat.id);

  // Whether the seat lands at Asked or rests at Bailed depends on the re-ask
  // below — the bailer is excluded from it either way. (rankedEligible reads only
  // the seat's shift + id; its current state/occupant don't affect the pool.)
  const pool = await rankedEligible(repo, seat, new Set([bailer]));

  if (pool.length === 0) {
    // Exhausted: rest at Bailed (occupant cleared) → shift derives AtRisk.
    const bailed: Seat = { ...seat, state: "Bailed" };
    delete bailed.assignedCrewMemberId;
    await repo.saveSeat(bailed);
    await refreshShiftState(repo, seat.shiftId);
    return { reAsks: [], seatState: "Bailed" };
  }

  // Candidates exist: clear Bailed, re-ask, seat → Asked.
  const reopened: Seat = { ...seat, state: "Asked" };
  delete reopened.assignedCrewMemberId;
  await repo.saveSeat(reopened);
  const reAsks = await Promise.all(
    pool.map((c) => fireAsk(repo, reopened, c.id, now)),
  );
  await refreshShiftState(repo, seat.shiftId);
  return { reAsks, seatState: "Asked" };
}

/**
 * Manual override (SPEC §2.4): Spink drops any person directly into a seat,
 * regardless of pool, rank, or current state — the authority backstop. Goes
 * straight to `Confirmed`. Logs no reliability event (an override is not the
 * person's responsiveness). If the seat already had a different occupant, this
 * silently displaces them with no `shift_bailed` trace — intentional: an override
 * is Spink's hammer, not a bail by the displaced person. (A "notify the displaced
 * crew" concern, if it ever matters, is a UI/notification job, not domain state.)
 */
export async function manualOverride(
  repo: Repository,
  seatId: SeatId,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<Seat | null> {
  void now;
  const seat = await repo.getSeat(seatId);
  if (!seat) return null;
  const confirmed: Seat = {
    ...seat,
    state: "Confirmed",
    assignedCrewMemberId: crewMemberId,
  };
  await repo.saveSeat(confirmed);
  await refreshShiftState(repo, seat.shiftId);
  return confirmed;
}

/**
 * Resolve which protocol works a seat: the person's override wins, else the
 * per-role default the caller supplies. Branch-free on role (DEC-ROLE-1) — the
 * default is passed in, never derived from a role *name*. (Storing the per-role
 * default on `RoleType` is a noted follow-up; today the caller provides it.)
 */
export function resolveProtocol(
  crew: CrewMember,
  roleDefault: "ask_then_assign" | "assign_then_confirm",
): "ask_then_assign" | "assign_then_confirm" {
  return crew.protocolOverride ?? roleDefault;
}
