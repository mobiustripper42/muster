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

import type { Ask, CrewMember, Event, Seat } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { AskId, CrewMemberId, SeatId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import {
  bailLatenessMs,
  deriveShiftState,
  earliestScheduledStart,
} from "../builder/derive.js";
import { TENANT_TIMEZONE, withinCivilWindow } from "../config/tenant.js";
import { isAskableFor, isRatedFor } from "../oracle/eligibility.js";
import { eligiblePool } from "../oracle/oracle.js";
import { rankEligibleIds } from "../oracle/reliability-score.js";
import {
  logAskAccepted,
  logAskDeclined,
  logAskIgnored,
  logAskSent,
  logShiftBailed,
} from "../oracle/reliability-log.js";

/** Default channel for a domain-core ask; the real adapter sets this at M4. */
const DEFAULT_CHANNEL = "push" as const;

// ── Internal helpers ────────────────────────────────────────────────────────

/** Re-derive and persist a shift's state after a seat change (keeps the badge true). */
export async function refreshShiftState(
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

/**
 * The eligible crew for a seat, ranked by reliability (§2.4), optionally
 * excluding ids (e.g. a bailer). Already-committed-on-shift crew are dropped
 * internally (distinct-pool, DEC-003) — callers pass only their *extra*
 * exclusions. Also drops crew **over-ranked** for the seat (#148, DEC-066): a
 * captain rated `[captain, mate]` is never *asked* for a mate seat. This is the
 * one askable pool — every ask/suggest path reads it: auto-ask, the drip,
 * bail/remove re-asks, lean, the guarded assign (`assignFromPool`), the
 * assignment-view seat-card pool, escalate, and the board's `available` lean
 * list. The cockpit override seats by `isRatedFor` and does NOT read it, so
 * captains stay manually assignable. `now` is the scoring instant for the ranker.
 * Exported so Tier-2 (`escalate`) shares one copy of the intra-shift distinct-pool rule.
 */
export async function rankedEligible(
  repo: Repository,
  seat: Seat,
  now: Date,
  exclude: ReadonlySet<CrewMemberId> = new Set(),
): Promise<CrewMember[]> {
  const pools = await eligiblePool(repo, seat.shiftId);
  const pool = pools.find((p) => p.seatId === seat.id);
  if (!pool) return [];
  // Also exclude anyone already holding another seat on this same shift.
  const onShift = await committedOnShift(repo, seat.shiftId, seat.id);
  const ids = pool.eligible.filter((id) => !exclude.has(id) && !onShift.has(id));
  const ranked = await rankEligibleIds(repo, ids, now);
  // #148 (DEC-066): drop crew over-ranked for this seat — a captain rated
  // [captain, mate] is never *asked* for a mate seat. The override seats them by
  // isRatedFor (DEC-064), not this pool, so manual placement is unaffected.
  return ranked.filter((c) => isAskableFor(c.ratings, seat.role));
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
  const pool = await rankedEligible(repo, seat, now);
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

/**
 * Drip widen (DEC-063): fire **one** ask to the top-ranked *un-asked* eligible
 * candidate for a seat — the staged counterpart to `broadcastAsk`'s blast. Sets
 * `Open → Asked` if the seat just (re)opened; earlier asks are left untouched, so
 * the open asks **accumulate** and first-acceptable-yes-wins still decides among
 * them. Returns the ask, or `null` when no un-asked candidate is left to widen to
 * (pool walked) or the seat isn't workable (not `Open`/`Asked`). The tick gates
 * *when* this fires (`ASK_DRIP_INTERVAL_MINUTES`); keeping the fan-out primitive
 * here means the seed and every widen are the same one tested call. Looping it
 * until `null` blasts the remaining pool (the tick's urgent / interval-0 path).
 */
export async function widenAsk(
  repo: Repository,
  seatId: SeatId,
  now: Date,
): Promise<Ask | null> {
  const seat = await repo.getSeat(seatId);
  if (!seat || (seat.state !== "Open" && seat.state !== "Asked")) return null;
  const asked = new Set(
    (await repo.listAsksForSeat(seatId)).map((a) => a.crewMemberId),
  );
  const [pick] = await rankedEligible(repo, seat, now, asked);
  if (!pick) return null; // pool walked — nothing un-asked left
  if (seat.state === "Open") {
    await repo.saveSeat({ ...seat, state: "Asked" });
  }
  const ask = await fireAsk(repo, seat, pick.id, now);
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
   *  - `already_answered` — this ask was already responded to (or timed out);
   *    a re-tap is an idempotent no-op and never re-logs (#145).
   */
  reason?: "already_filled" | "double_booked" | "already_answered";
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

  // #145: an already-answered (or timed-out) ask is closed — a re-tap must not
  // re-log ask_accepted/declined or re-stamp respondedAt. No-op idempotently.
  if (ask.respondedAt !== undefined) {
    return { claimed: false, reason: "already_answered", seatState: seat.state };
  }

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
    // No `delete acquiredVia` needed: an Asked seat never carries provenance
    // (only a Confirmed write sets it; bail/vacate clear it on the way back). #196.
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

/**
 * Record a response and, on a winning accept, confirm it in one step — the
 * "in = committed" path (DEC-061). A winning accept advances
 * `Asked → Claimed → Confirmed`; every other outcome (contested loss,
 * double-book, decline, no live claim) passes `recordResponse`'s result through
 * untouched. Applies to both protocols (DEC-007): the mate broadcast's first-yes
 * and the named-captain's accept.
 *
 * **Confirm is gated on `outcome.claimed === true`, never on seat state.** A
 * contested loser's response leaves the seat `Claimed` *by the winner*, so a
 * state-keyed gate would confirm the wrong person; only the CAS winner is
 * `claimed:true`. If the seat moved underfoot between the claim and the confirm,
 * `confirmSeat` returns null and we pass the claim outcome through — never throw.
 *
 * Both answer surfaces route here (crew `respondToAsk`, operator-as-crew
 * `recordResponseAs`), and the M4 inbound-channel adapter must too — funnelling a
 * real "in" reply into raw `recordResponse` would strand it at `Claimed`.
 */
export async function recordResponseAndConfirm(
  repo: Repository,
  askId: AskId,
  response: "accepted" | "declined",
  now: Date,
): Promise<ResponseOutcome> {
  const outcome = await recordResponse(repo, askId, response, now);
  if (!outcome.claimed) return outcome;
  const ask = await repo.getAsk(askId);
  if (!ask) return outcome; // unreachable after a winning claim; defensive
  const confirmed = await confirmSeat(repo, ask.seatId, now);
  return confirmed ? { ...outcome, seatState: "Confirmed" } : outcome;
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
    // Asked seats carry no provenance, so no `delete acquiredVia` here (#196).
    await repo.saveSeat({ ...seat, state: "Open" });
    await refreshShiftState(repo, seat.shiftId);
  }
  return expired;
}

export interface BailOutcome {
  /** Asks fired to re-crew the seat (empty → pool exhausted → seat rests Bailed). */
  reAsks: Ask[];
  /** The seat's state after the bail: `Asked` if re-asked; `Bailed` when the
   * pool is exhausted; `Open` when the re-ask deferred past civil hours
   * (DEC-088 — the next in-window tick re-crews it). */
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
  noticeMs?: number,
  expectedBailer?: CrewMemberId,
  opts?: { tz?: string; civilWindow?: { start: string; end: string } },
): Promise<BailOutcome> {
  const seat = await repo.getSeat(seatId);
  if (
    !seat ||
    seat.state !== "Confirmed" ||
    !seat.assignedCrewMemberId ||
    // Occupant pin: a caller that validated WHO is bailing passes them here,
    // so an occupant swap between its read and this one can't log
    // `shift_bailed` against the wrong person (no transactions — this re-check
    // is the only thing closing that window).
    (expectedBailer !== undefined && seat.assignedCrewMemberId !== expectedBailer)
  ) {
    throw new Error(`seat ${seatId} is not a confirmed seat to bail`);
  }
  const bailer = seat.assignedCrewMemberId;
  await logShiftBailed(
    repo,
    bailer,
    seat.shiftId,
    now,
    latenessMs,
    seat.id,
    noticeMs,
  );

  // Whether the seat lands at Asked or rests at Bailed depends on the re-ask
  // below — the bailer is excluded from it either way. (rankedEligible reads only
  // the seat's shift + id; its current state/occupant don't affect the pool.)
  const pool = await rankedEligible(repo, seat, now, new Set([bailer]));

  if (pool.length === 0) {
    // Exhausted: rest at Bailed (occupant cleared) → shift derives AtRisk.
    const bailed: Seat = { ...seat, state: "Bailed" };
    delete bailed.assignedCrewMemberId;
    delete bailed.acquiredVia; // provenance is the occupant's — clear on re-open (#196)
    await repo.saveSeat(bailed);
    await refreshShiftState(repo, seat.shiftId);
    return { reAsks: [], seatState: "Bailed" };
  }

  // Civil send window (DEC-088): candidates exist, but outside civil hours the
  // engine defers its own re-ask — rest at **Open** (occupant cleared; the
  // `shift_bailed` log above already happened at bail time). The next in-window
  // tick's drip re-crews it immediately (`widenDue` is true for an Open seat) —
  // and rides the DEC-063 drip rather than this inline pool-wide blast. NOT
  // `Bailed`: nobody's exhausted; resting Bailed would fake an AtRisk.
  if (!withinCivilWindow(now, opts?.tz, opts?.civilWindow)) {
    const deferred: Seat = { ...seat, state: "Open" };
    delete deferred.assignedCrewMemberId;
    delete deferred.acquiredVia; // provenance is the occupant's — clear on re-open (#196)
    await repo.saveSeat(deferred);
    await refreshShiftState(repo, seat.shiftId);
    return { reAsks: [], seatState: "Open" };
  }

  // Candidates exist: clear Bailed, re-ask, seat → Asked.
  const reopened: Seat = { ...seat, state: "Asked" };
  delete reopened.assignedCrewMemberId;
  delete reopened.acquiredVia; // provenance is the occupant's — clear on re-open (#196)
  await repo.saveSeat(reopened);
  const reAsks = await Promise.all(
    pool.map((c) => fireAsk(repo, reopened, c.id, now)),
  );
  await refreshShiftState(repo, seat.shiftId);
  return { reAsks, seatState: "Asked" };
}

export interface DerivedBailResult {
  /**
   * null = the bail landed. "raced" = the seat changed underfoot (gone, not
   * Confirmed, or a different occupant than the caller validated) — reload.
   */
  code: "raced" | null;
  outcome?: BailOutcome;
}

/**
 * `bail()` with the DEC-028 lateness derived in core: loads the shift's
 * events, computes `bailLatenessMs` + the raw signed notice, threads both, and
 * pins the occupant. The ONE home of this glue — the crew "can't make it" and
 * the admin "reports a bail" both call it, so the noticeMs threading (the
 * permanent-log part, DEC-008) can't drift between surfaces.
 *
 * `expectedBailer` is the occupant the caller validated; an occupant swap in
 * between reads returns `raced` instead of logging against the wrong person.
 * Wrinkle: a repo failure *inside* `bail()` also surfaces as `raced` (the seat
 * may have partially changed — "reload" is the honest instruction either way);
 * failures in the reads BEFORE it propagate, so callers can still map a plain
 * outage to their "nothing was changed" copy.
 */
export async function bailWithDerivedLateness(
  repo: Repository,
  seatId: SeatId,
  now: Date,
  expectedBailer?: CrewMemberId,
  tz: string = TENANT_TIMEZONE,
): Promise<DerivedBailResult> {
  const seat = await repo.getSeat(seatId);
  if (
    !seat ||
    seat.state !== "Confirmed" ||
    !seat.assignedCrewMemberId ||
    (expectedBailer !== undefined && seat.assignedCrewMemberId !== expectedBailer)
  ) {
    return { code: "raced" };
  }
  const shift = await repo.getShift(seat.shiftId);
  const events: Event[] = [];
  for (const eventId of shift?.eventIds ?? []) {
    const event = await repo.getEvent(eventId);
    if (event) events.push(event);
  }
  const tripStart = earliestScheduledStart(events, tz);
  try {
    const outcome = await bail(
      repo,
      seatId,
      now,
      bailLatenessMs(tripStart, now),
      tripStart ? tripStart.getTime() - now.getTime() : undefined,
      seat.assignedCrewMemberId,
      { tz },
    );
    return { code: null, outcome };
  } catch {
    return { code: "raced" };
  }
}

export interface VacateOutcome {
  /** Asks fired to re-crew the seat (empty → pool exhausted → seat rests Open). */
  reAsks: Ask[];
  /** The seat's state after the vacate: `Asked` if re-asked, else `Open`. */
  seatState: Seat["state"];
}

/**
 * No-penalty vacate of a confirmed seat (#87) — the operator corrects a
 * *misassignment* (wrong person placed), not a bail. The `bail()` body **minus
 * `logShiftBailed`**: drop the occupant, re-ask the next candidates, but write
 * **no** reliability event — nobody actually backed out, so nothing should count
 * against the removed person's record.
 *
 * The split from `bail()` is deliberate per #87: an explicit operator choice
 * (correction vs bail), never a default checkbox — a wrong default either starves
 * the reliability log or wrongly penalizes. `bail()`/`bailWithDerivedLateness`
 * stay the home of the *did-bail* path.
 *
 * Two differences from `bail()` beyond the missing log:
 * - **Exhausted pool rests at `Open`, not `Bailed`.** No one bailed, so the seat
 *   is honestly just open again; `resolveShiftState`'s horizon clock decides when
 *   that becomes AtRisk, rather than `deriveShiftState` flagging an immediate
 *   bail-driven AtRisk with "crew bailed" copy.
 * - The removed occupant is excluded from the immediate re-ask (you just decided
 *   they shouldn't hold this seat); the operator can still override them back.
 *
 * `expectedOccupant` is the occupant the caller validated; an occupant swap
 * between reads throws (mapped to `raced` by the action), so a correction can't
 * silently clear a *different* person than the operator saw.
 */
export async function vacateSeat(
  repo: Repository,
  seatId: SeatId,
  now: Date,
  expectedOccupant?: CrewMemberId,
  opts?: { tz?: string; civilWindow?: { start: string; end: string } },
): Promise<VacateOutcome> {
  const seat = await repo.getSeat(seatId);
  if (
    !seat ||
    seat.state !== "Confirmed" ||
    !seat.assignedCrewMemberId ||
    (expectedOccupant !== undefined && seat.assignedCrewMemberId !== expectedOccupant)
  ) {
    throw new Error(`seat ${seatId} is not a confirmed seat to vacate`);
  }
  const removed = seat.assignedCrewMemberId;
  const pool = await rankedEligible(repo, seat, now, new Set([removed]));

  // Civil send window (DEC-088): a vacate's re-ask is engine initiative (the
  // operator's intent was "remove this person", not "text the pool at 23:00")
  // — outside civil hours it takes the exhausted branch below: rest Open, no
  // sends; the next in-window tick's drip re-crews it.
  const deferSends = !withinCivilWindow(now, opts?.tz, opts?.civilWindow);

  if (pool.length === 0 || deferSends) {
    // Exhausted: rest at Open (occupant cleared) — no bail, so no AtRisk yet;
    // the horizon clock governs urgency via resolveShiftState.
    const opened: Seat = { ...seat, state: "Open" };
    delete opened.assignedCrewMemberId;
    delete opened.acquiredVia; // provenance is the occupant's — clear on re-open (#196)
    await repo.saveSeat(opened);
    await refreshShiftState(repo, seat.shiftId);
    return { reAsks: [], seatState: "Open" };
  }

  const reopened: Seat = { ...seat, state: "Asked" };
  delete reopened.assignedCrewMemberId;
  delete reopened.acquiredVia; // provenance is the occupant's — clear on re-open (#196)
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
    // Provenance (#196): an override is the operator force-placing someone, so My
    // shifts flags it "Added for you". Overwrites any prior `self_claim` if the
    // operator is displacing a self-claimer.
    acquiredVia: "operator",
  };
  await repo.saveSeat(confirmed);
  await refreshShiftState(repo, seat.shiftId);
  return confirmed;
}

export interface OverrideResult {
  /**
   * null = placed. `not_rated` = the crew lacks the seat's role rating — a mate
   * can't hold a captain seat (DEC-064). `gone` = no such seat or crew.
   */
  code: "not_rated" | "gone" | null;
  seat?: Seat;
}

/**
 * Role-guarded manual override (DEC-064). The cockpit's "place anyone" backstop,
 * minus the one thing it must not do: seat a crew member who isn't rated for the
 * role (a mate as captain — a license floor, not Spink's to override). Still
 * bypasses pool, rank, and current state — that's `manualOverride`, which this
 * composes after the rating check. Captains stay placeable into mate seats: on
 * the pilot roster they're rated `[captain, mate]`, so `isRatedFor` passes them.
 */
export async function overrideSeat(
  repo: Repository,
  seatId: SeatId,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<OverrideResult> {
  const seat = await repo.getSeat(seatId);
  if (!seat) return { code: "gone" };
  const crew = await repo.getCrewMember(crewMemberId);
  if (!crew) return { code: "gone" };
  if (!isRatedFor(crew.ratings, seat.role)) return { code: "not_rated" };
  const placed = await manualOverride(repo, seatId, crewMemberId, now);
  return placed ? { code: null, seat: placed } : { code: "gone" };
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
