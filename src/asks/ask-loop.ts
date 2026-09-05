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

import type { Ask, AskAnswer, CrewMember, Event, Seat } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { AskId, CrewMemberId, SeatId } from "../domain/ids.js";
import { TERMINAL_SHIFT_STATES } from "../domain/states.js";
import type { Repository } from "../ports/repository.js";
import {
  bailLatenessMs,
  deriveShiftState,
  earliestScheduledStart,
  resolveShiftState,
  staffingHorizonFromEvents,
  STAFFING_HORIZON_LEAD_DAYS,
} from "../builder/derive.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";
import { isAskableFor, isRatedFor, notDoubleBooked } from "../oracle/eligibility.js";
import {
  committedDatesByCrew,
  eligiblePool,
  poolExhaustedFor,
} from "../oracle/oracle.js";
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
  // Lifecycle states are terminal — a seat mutation never resurrects a cancelled
  // or completed shift. `deriveShiftState` is a pure seat-fold that can only yield
  // Crewed/AtRisk/Filling/Pending, so without this guard a bail/decline/claim on a
  // leftover seat (DEC-084 keeps seats on cancel) would overwrite `Cancelled` with a
  // live state, un-hiding the shift and re-arming the tick's ask loop. Mirrors the
  // tick's own terminal guard and #20's Completed guard in formShifts.
  if (TERMINAL_SHIFT_STATES.has(shift.state)) return;
  const seats = await repo.listSeatsForShift(shiftId);
  await repo.saveShift({ ...shift, state: deriveShiftState(seats) });
}

/**
 * Horizon-aware sibling of `refreshShiftState` (DEC-128, #483) — persists the
 * **composed** `resolveShiftState` (seat-fold + staffing-horizon clock, DEC-022)
 * rather than the raw seat-fold, under the same terminal guard. `bail()` and
 * `vacateSeat()` call this so a re-opened seat lands in its horizon-correct status
 * **synchronously**: pre-horizon → `Pending` (silent — the #483 fix), in-horizon
 * with a live pool → `Filling` (the next tick drips), past-horizon exhausted →
 * `AtRisk` via `resolveShiftState(poolExhausted)` — no longer via a resting
 * `Bailed` seat. Without this, a pre-horizon bail would momentarily write the
 * raw fold's `Filling`/`Pending` and (for an exhausted pool) never the right state.
 *
 * **Scoped to bail+vacate on purpose** (not globalized): the drip hot path and the
 * claim/override paths only ever move a shift *toward* crewed, which
 * `resolveShiftState` passes through unchanged and the next tick self-heals — so
 * they keep the cheaper `refreshShiftState`. Composes `resolveShiftState` +
 * `staffingHorizonFromEvents` + `poolExhaustedFor` (the last relocated to
 * `oracle.ts` to keep this import cycle-free — `tick.ts` imports this module).
 */
export async function refreshShiftStateHorizon(
  repo: Repository,
  shiftId: Seat["shiftId"],
  now: Date,
): Promise<void> {
  const shift = await repo.getShift(shiftId);
  if (!shift) return;
  // Same terminal guard as `refreshShiftState`: never resurrect a Cancelled/
  // Completed shift off a leftover seat (DEC-084).
  if (TERMINAL_SHIFT_STATES.has(shift.state)) return;
  const seats = await repo.listSeatsForShift(shiftId);
  const events: Event[] = [];
  for (const eventId of shift.eventIds) {
    const event = await repo.getEvent(eventId);
    if (event) events.push(event);
  }
  const horizon = staffingHorizonFromEvents(
    events,
    STAFFING_HORIZON_LEAD_DAYS,
    TENANT_TIMEZONE,
  );
  const poolExhausted = await poolExhaustedFor(repo, shift, seats, now);
  await repo.saveShift({
    ...shift,
    state: resolveShiftState(seats, { now, horizon, poolExhausted }),
  });
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
 * beyond what the caller did — Eric names whom he names; `manualOverride` is the
 * harder backstop. Returns the ask, or null if the seat wasn't open.
 */
export async function assignPerson(
  repo: Repository,
  seatId: SeatId,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<Ask | null> {
  const seat = await repo.getSeat(seatId);
  // `Open` OR `Asked` (#601). That one guard was doing two jobs: refusing a SETTLED
  // seat (Claimed/Confirmed — essential, kept) and refusing an already-`Asked` one,
  // which is the over-broad half. `widenAsk` twelve lines down has always accepted
  // both, letting asks ACCUMULATE on an `Asked` seat with first-acceptable-yes-wins
  // deciding between them (DEC-007/061) — so a second outstanding ask is the drip's
  // own normal behaviour, not a new concept. Without this, `lean()` could never nudge
  // onto a filling seat, and DEC-063 makes `Asked` the normal state of one.
  //
  // Callers still gate upstream and are unaffected: `escalate` passes `Open` seats
  // only, `lean` filters via `gapSeats`, `assignFromPool` has its own `no_gap`.
  if (!seat || (seat.state !== "Open" && seat.state !== "Asked")) return null;
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
 *
 * `exclude` is unioned onto the seat's own already-asked set — the tick passes it
 * to enforce one-boat-per-day (#393): a candidate holding a live ask on another
 * boat the same vessel-local day is skipped so same-day boats spread across
 * people. Defaults to empty, so every non-tick caller is unchanged.
 */
export async function widenAsk(
  repo: Repository,
  seatId: SeatId,
  now: Date,
  exclude: ReadonlySet<CrewMemberId> = new Set(),
): Promise<Ask | null> {
  const seat = await repo.getSeat(seatId);
  if (!seat || (seat.state !== "Open" && seat.state !== "Asked")) return null;
  const asked = askedSetFrom(await repo.listAsksForSeat(seatId));
  for (const id of exclude) asked.add(id);
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
  response: AskAnswer,
  now: Date,
): Promise<ResponseOutcome> {
  const ask = await repo.getAsk(askId);
  if (!ask) throw new Error(`no ask ${askId}`);
  const seat = await repo.getSeat(ask.seatId);
  if (!seat) throw new Error(`no seat ${ask.seatId}`);

  // #145: an already-answered (or timed-out) ask is closed — a re-tap must not
  // re-log ask_accepted/declined or re-stamp respondedAt. No-op idempotently.
  //
  // **A `withdrawn` ask is the exception and it is still answerable (#600).** The
  // withdrawal exists to stop `expireAsks` inventing an `ask_ignored` for a seat that
  // got taken; it is emphatically NOT a refusal of the crew member's own answer. Six
  // captains asked, one accepts at 51 seconds, a second taps "Yes" ten minutes later:
  // they lost the seat, but they ANSWERED, and DEC-120 pays responsiveness regardless
  // of outcome (`ask_accepted` +2, the contested-loss credit). Treating `withdrawn` as
  // closed here silently deleted that credit — three existing tests caught it, and the
  // tests were right. Their real answer overwrites the marker below; the seat is
  // already filled, so they fall through to the `already_filled` contested path.
  if (ask.respondedAt !== undefined && ask.response !== "withdrawn") {
    return { claimed: false, reason: "already_answered", seatState: seat.state };
  }

  // Latency is measured from `sentAt`, so a withdrawn-then-answered ask reports the
  // crew member's true reply time — the withdrawal instant is not part of the signal.
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
      // Cross-shift guard (#522 sweep 3). This was the ONE seating path that never
      // re-ran eligibility: `committedOnShift` above scans a single shift, and
      // `notDoubleBooked` runs at fan-out time, when the candidate is committed
      // nowhere — an outstanding ask is deliberately not a commitment.
      //
      // The tick's #393 one-boat-per-day spread normally stops two same-day asks
      // reaching one person, but the urgent blast path drops it (`tick.ts` passes
      // only `suppression.working`, never the day exclusion). Two boats inside
      // fills-by on a thin captain pool → two texts, two taps, both shifts green,
      // one boat with nobody at the dock. The At-Risk board can't catch it: both
      // shifts resolve `Crewed`.
      //
      // Calls the SHARED rule rather than re-implementing a date check, so #560 —
      // which asks whether this becomes a time-overlap rule instead of whole-day —
      // stays a one-site change in `notDoubleBooked` that every path inherits.
      // Until then this is what SPEC §2.7.2 and DEC-078 already claim is enforced.
      //
      // KNOWN GAP, the same one #554 documents at `claim.ts:111-119` and DEC-078's
      // amendment banner names: this is a read-then-CAS over a cross-record invariant
      // the no-FK store cannot enforce. The CAS below compares only THIS seat's state,
      // so two genuinely concurrent accepts for two same-date shifts both read an empty
      // set, both pass here, and both win. What this closes is the SEQUENTIAL case —
      // two texts, two taps, minutes apart — which needed no interleaving at all.
      // #554 must list this file alongside `claim.ts`; fixing it there won't fix it here.
      const shift = await repo.getShift(seat.shiftId);
      if (!shift) {
        // Fail CLOSED. Every other missing precondition in this function throws, and a
        // guard that seats someone when it can't evaluate itself is the wrong posture —
        // especially this one, whose failure mode is a boat with nobody at the dock.
        throw new Error(`no shift ${seat.shiftId} for seat ${seat.id}`);
      }
      const committed = await committedDatesByCrew(repo, seat.shiftId);
      const elsewhere = committed.get(ask.crewMemberId) ?? new Set<string>();
      if (!notDoubleBooked(elsewhere, shift.date).passed) {
        return { claimed: false, reason: "double_booked", seatState: seat.state };
      }
      // Atomic compare-and-swap (REQ-CLAIM-1): claim only if STILL Asked.
      const won = await repo.saveSeatIfState(
        { ...seat, state: "Claimed", assignedCrewMemberId: ask.crewMemberId },
        "Asked",
      );
      if (won) {
        // #600: the seat is filled, so every other outstanding ask on it is moot.
        // Retire them NOW rather than leaving them live to be mis-swept as
        // `ask_ignored` whenever the seat next reopens. Only on the CAS win — a
        // contested loser didn't fill the seat and must not close anyone's ask.
        await withdrawLiveAsks(repo, seat.id, now, askId);
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

/**
 * Retire every still-live ask on a seat that has just been filled (#600) — the
 * losers of a broadcast. `respondedAt` stamped, `response: "withdrawn"`, and
 * **no reliability event**: nothing happened worth scoring.
 *
 * **This is the fix for #600, and the ordering is the whole bug.** `recordResponse`
 * used to close only the winner's ask, so an ask's lifecycle was keyed to its own row
 * and never to the seat's state. The losers stayed live — correctly un-swept while the
 * seat was filled, because the tick only sweeps `Asked` seats (DEC-067) — and then
 * detonated the moment the seat reopened: `expireAsks` found them, measured `sentAt`
 * against the timeout, and stamped `ask_ignored` on all of them in one pass. In prod
 * that charged five captains −3 each for silence on an ask from **nine days earlier**,
 * on a seat that had been taken 51 seconds after they were asked. Their liveness
 * outlived their relevance; the missing event type was a symptom of that, not the cause.
 *
 * `exceptAskId` skips the winning ask, which already carries its real `accepted`.
 * Omit it when the seat was filled by a door that isn't an ask — a self-claim or an
 * operator override — where EVERY live ask is moot, including one held by the person
 * who just took the seat through the other door.
 *
 * **Called from all three fill paths, which is the point.** `recordResponse` is only
 * one way a seat gets filled: `claimSeat` can take an `Asked` seat (legal since #440)
 * and `manualOverride` can force-place onto one. Fixing only the ask path would leave
 * the identical bug reachable through the other two doors — the shape this codebase
 * has been bitten by before (a second list of the same thing always drifts).
 */
export async function withdrawLiveAsks(
  repo: Repository,
  seatId: SeatId,
  now: Date,
  exceptAskId?: AskId,
): Promise<number> {
  let withdrawn = 0;
  for (const ask of await repo.listAsksForSeat(seatId)) {
    if (exceptAskId !== undefined && ask.id === exceptAskId) continue;
    if (ask.respondedAt !== undefined) continue; // already answered or swept
    await repo.saveAsk({
      ...ask,
      respondedAt: now.toISOString(),
      response: "withdrawn",
    });
    withdrawn++;
  }
  return withdrawn;
}

/**
 * Who has already been *genuinely* asked for this seat — the drip's don't-re-ask set.
 *
 * **A `withdrawn` ask does not count (#600).** The set exists to stop pestering
 * someone with the same question twice; a withdrawn ask never got a fair answer,
 * because the seat was taken out from under it. Counting it would permanently bar the
 * losers of one broadcast from ever being asked again for that seat — so the five
 * captains who lost `Brew 4 · Jul 29` by 51 seconds would be skipped for the rest of
 * that seat's life, having done nothing.
 *
 * Timed-out asks (`respondedAt` set, no `response`) DO count — they were asked and
 * stayed silent. Declines count. Live asks count (they're mid-flight).
 *
 * **One definition on purpose.** `widenAsk` and the tick's drip branch both need this,
 * and `tick.ts` asserts by construction that its own pick equals `widenAsk`'s — two
 * copies of the rule would let that invariant rot silently, which is the exact shape
 * that bit us before.
 */
export function askedSetFrom(asks: readonly Ask[]): Set<CrewMemberId> {
  const asked = new Set<CrewMemberId>();
  for (const a of asks) {
    if (a.response === "withdrawn") continue;
    asked.add(a.crewMemberId);
  }
  return asked;
}

/** Every ask on the seat has a response or has timed out (no live ask remains). */
async function allAsksClosed(repo: Repository, seatId: SeatId): Promise<boolean> {
  const asks = await repo.listAsksForSeat(seatId);
  // An ask is "closed" once it has a respondedAt (a real response OR a timeout
  // stamp — see expireAsks). A live, unanswered ask has no respondedAt.
  return asks.every((a) => a.respondedAt !== undefined);
}

/**
 * Confirm a claimant into the seat (`Claimed → Confirmed`) — Eric's confirm, or
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
  response: AskAnswer,
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

/**
 * A confirmed crew backs out (DEC-019, amended by DEC-128 / #483): log
 * `shift_bailed` (+`latenessMs`), drop the occupant, clear provenance, rest the
 * seat **`Open`**, and refresh the shift's state horizon-aware — then return.
 * **The bail fires no asks.** Re-crewing is left entirely to the tick, the sole
 * ask-writer: pre-horizon the shift resolves `Pending` (silent — the #483 fix,
 * no more pool-blast weeks out), in-horizon the next tick drips (DEC-063), inside
 * `fillsBy` the tick's urgent path re-crews within one cadence. `Bailed` is
 * retired as a resting state; a past-horizon exhausted pool now surfaces `AtRisk`
 * via `resolveShiftState(poolExhausted)` (the horizon refresh), not via the seat.
 */
export async function bail(
  repo: Repository,
  seatId: SeatId,
  now: Date,
  latenessMs: number,
  noticeMs?: number,
  expectedBailer?: CrewMemberId,
): Promise<void> {
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

  // Drop the occupant, clear provenance (it's the occupant's — #196), rest Open.
  // No re-ask: the tick re-crews (DEC-128). The horizon-aware refresh lands the
  // shift in its correct status synchronously — Pending pre-horizon (silent),
  // Filling in-horizon, AtRisk only for a past-horizon exhausted pool.
  const reopened: Seat = { ...seat, state: "Open" };
  delete reopened.assignedCrewMemberId;
  delete reopened.acquiredVia;
  await repo.saveSeat(reopened);
  await refreshShiftStateHorizon(repo, seat.shiftId, now);
}

export interface DerivedBailResult {
  /**
   * null = the bail landed. "raced" = the seat changed underfoot (gone, not
   * Confirmed, or a different occupant than the caller validated) — reload.
   * "trainee_seat" = a supernumerary ride (DEC-087): a trainee stepping off is
   * not a bail — no reliability event, no re-ask; `unstaffTraineeSeat` is the
   * path (the caller maps this to "tell the office" copy).
   * "shift_over" = the shift already `Completed` (#570) — you cannot back out of
   * work you already did; see the guard for why this is a refusal, not a no-op.
   */
  code: "raced" | "trainee_seat" | "shift_over" | null;
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
  // Trainee seats never take the bail rail (DEC-087): the ask engine ignores
  // them, so re-asking is wrong, and a ride isn't a reliability commitment, so
  // logging shift_bailed is wrong too. Checked BEFORE the raced conditions so
  // both the crew self-drop and the admin report get the specific code.
  if (seat && seat.kind === "supernumerary") return { code: "trainee_seat" };
  if (
    !seat ||
    seat.state !== "Confirmed" ||
    !seat.assignedCrewMemberId ||
    (expectedBailer !== undefined && seat.assignedCrewMemberId !== expectedBailer)
  ) {
    return { code: "raced" };
  }
  const shift = await repo.getShift(seat.shiftId);
  // You cannot bail out of work you already did (#570). The seat guards above are
  // the only ones `bail()` has, so before completion existed this was merely odd:
  // a crew member tapping "can't make it" on the evening of a trip they'd already
  // run took the full penalty (notice is negative once departed, so
  // `bailLatenessMs` saturates at the whole lead — −11.4 at the default horizon).
  // Completion makes it incoherent as well as unfair: the occupant would hold a +5
  // `shift_completed` AND a −11.4 `shift_bailed` for the same trip, and because
  // `refreshShiftStateHorizon` returns early on a terminal state, the shift would
  // sit `Completed` with a newly `Open` seat under it.
  //
  // A refusal, not a silent no-op: both callers (the crew "can't make it" and the
  // admin "report a bail") need to say something true to a human, and "that shift
  // already ran" is it.
  if (shift?.state === "Completed") return { code: "shift_over" };
  const events: Event[] = [];
  for (const eventId of shift?.eventIds ?? []) {
    const event = await repo.getEvent(eventId);
    if (event) events.push(event);
  }
  const tripStart = earliestScheduledStart(events, tz);
  try {
    await bail(
      repo,
      seatId,
      now,
      bailLatenessMs(tripStart, now),
      tripStart ? tripStart.getTime() - now.getTime() : undefined,
      seat.assignedCrewMemberId,
    );
    return { code: null };
  } catch {
    return { code: "raced" };
  }
}

export interface VacateOutcome {
  /** The occupant cleared — the audit `crew_removed` subject (#400, DEC-118). */
  removed: CrewMemberId;
}

/**
 * No-penalty vacate of a confirmed seat (#87) — the operator corrects a
 * *misassignment* (wrong person placed), not a bail. The `bail()` body **minus
 * `logShiftBailed`**: drop the occupant, rest the seat `Open`, refresh
 * horizon-aware, but write **no** reliability event — nobody actually backed out,
 * so nothing should count against the removed person's record.
 *
 * The split from `bail()` is deliberate per #87: an explicit operator choice
 * (correction vs bail), never a default checkbox — a wrong default either starves
 * the reliability log or wrongly penalizes. `bail()`/`bailWithDerivedLateness`
 * stay the home of the *did-bail* path.
 *
 * Like `bail()` post-DEC-128 (#483), vacate **fires no asks** — it rests the seat
 * `Open` and leaves re-crewing to the tick. It never rested `Bailed` even before
 * (no one bailed), so nothing there changes; the horizon-aware refresh keeps the
 * shift's badge correct (`Pending` pre-horizon, `Filling` in-horizon), and a
 * past-horizon exhausted pool surfaces `AtRisk` via `resolveShiftState`, not the
 * seat. The operator can still override the removed person back.
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
): Promise<VacateOutcome> {
  const seat = await repo.getSeat(seatId);
  // DEC-087 rail guard: a trainee seat is the engine's blind spot —
  // `unstaffTraineeSeat` is the no-re-ask path. Edges guard first; this is the backstop.
  if (seat && seat.kind === "supernumerary") {
    throw new Error(`seat ${seatId} is a trainee seat — unstaff it, don't vacate`);
  }
  if (
    !seat ||
    seat.state !== "Confirmed" ||
    !seat.assignedCrewMemberId ||
    (expectedOccupant !== undefined && seat.assignedCrewMemberId !== expectedOccupant)
  ) {
    throw new Error(`seat ${seatId} is not a confirmed seat to vacate`);
  }
  const removed = seat.assignedCrewMemberId;

  // Drop the occupant, clear provenance (#196), rest Open — no re-ask (DEC-128).
  // The tick re-crews; the horizon-aware refresh keeps the badge honest.
  const reopened: Seat = { ...seat, state: "Open" };
  delete reopened.assignedCrewMemberId;
  delete reopened.acquiredVia;
  await repo.saveSeat(reopened);
  await refreshShiftStateHorizon(repo, seat.shiftId, now);
  return { removed };
}

/**
 * Manual override (SPEC §2.4): Eric drops any person directly into a seat,
 * regardless of pool, rank, or current state — the authority backstop. Goes
 * straight to `Confirmed`. Logs no reliability event (an override is not the
 * person's responsiveness). If the seat already had a different occupant, this
 * silently displaces them with no `shift_bailed` trace — intentional: an override
 * is Eric's hammer, not a bail by the displaced person. (A "notify the displaced
 * crew" concern, if it ever matters, is a UI/notification job, not domain state.)
 *
 * Returns the placed seat plus, when the override bumped a *different* prior
 * occupant, that displaced crew id — the edge logs it as a `crew_removed` audit
 * event (#400, DEC-118). `displaced` is captured before the seat overwrite.
 */
export interface OverridePlacement {
  seat: Seat;
  /** The prior occupant this override bumped, if any (a different person). */
  displaced?: CrewMemberId;
}

export async function manualOverride(
  repo: Repository,
  seatId: SeatId,
  crewMemberId: CrewMemberId,
  now: Date,
): Promise<OverridePlacement | null> {
  const seat = await repo.getSeat(seatId);
  if (!seat) return null;
  // Capture the bumped occupant BEFORE the overwrite below (#400, DEC-118) — this
  // is the audit `crew_removed` subject for the displacement. Only a *different*
  // prior occupant is a displacement; re-placing the same person displaces no one.
  const priorOccupant = seat.assignedCrewMemberId;
  const displaced =
    priorOccupant && priorOccupant !== crewMemberId ? priorOccupant : undefined;
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
  // #600: the seat is filled by the operator's hand, so every outstanding ask on it
  // is moot — retire them rather than leave them to be mis-swept as `ask_ignored`
  // when the seat next reopens. No `exceptAskId`: the override isn't an ask, so even
  // a live ask held by the person being placed is retired.
  await withdrawLiveAsks(repo, seat.id, now);
  await refreshShiftState(repo, seat.shiftId);
  return { seat: confirmed, ...(displaced !== undefined ? { displaced } : {}) };
}

export interface OverrideResult {
  /**
   * null = placed. `not_rated` = the crew lacks the seat's role rating — a mate
   * can't hold a captain seat (DEC-064). `archived` = the crew is archived (#323,
   * DEC-096) — off every list, the one status the override backstop honors, so a
   * crafted post can't re-place someone who's been removed. `gone` = no such seat
   * or crew.
   */
  code: "not_rated" | "archived" | "gone" | null;
  seat?: Seat;
  /** The crew this override displaced, if any (#400, DEC-118) — a `crew_removed`. */
  displaced?: CrewMemberId;
}

/**
 * Role-guarded manual override (DEC-064). The cockpit's "place anyone" backstop,
 * minus the two things it must not do: seat a crew member who isn't rated for the
 * role (a mate as captain — a license floor, not Eric's to override), or seat an
 * ARCHIVED crew member (#323, DEC-096 — they're off every list). Still bypasses
 * pool, rank, and current state — that's `manualOverride`, which this composes
 * after the rating + archived checks. Captains stay placeable into mate seats: on
 * the pilot roster they're rated `[captain, mate]`, so `isRatedFor` passes them.
 * `inactive` is still placeable — a bench, not a removal.
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
  // Archived crew are off EVERY list (#323, DEC-096) — the override backstop is
  // the one place that ignores `inactive` (a bench stays placeable), so it must
  // still honor `archived`, or a crafted post could re-seat someone removed.
  if (crew.status === "archived") return { code: "archived" };
  const placed = await manualOverride(repo, seatId, crewMemberId, now);
  return placed
    ? {
        code: null,
        seat: placed.seat,
        ...(placed.displaced !== undefined ? { displaced: placed.displaced } : {}),
      }
    : { code: "gone" };
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
