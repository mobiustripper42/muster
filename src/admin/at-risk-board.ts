/**
 * The At-Risk board derivation (SPEC §2.5, #41) — which shifts summon Spink,
 * and in what order.
 *
 * Pure over the port: `deriveAtRiskBoard(repo, now, opts?)` reads shifts, seats,
 * events, asks, credentials and the escalation trail (DEC-024) and returns
 * board rows most-urgent first. Nothing is stored; membership is **recomputed on
 * read** (the DEC-023 corollary: the persisted shift state is eventually-
 * consistent, so a display surface must resolve state itself, never trust the
 * badge). The board UI (#42) gets membership ONLY from this deriver.
 *
 * A shift lands on the board for any of three reasons:
 *
 *  - **core** — a required seat is uncrewed and needs eyes. Two routes,
 *    deliberately asymmetric in *how far out* they summon:
 *    (a) the shift *resolves* `AtRisk` (eligibility-exhaustion: nobody CAN
 *        legally crew it, or a required seat rests `Bailed` — DEC-019/022) —
 *        summoned immediately, however far out the trip is; or
 *    (b) **imminence** (DEC-065): the shift still resolves `Filling` (eligible
 *        people exist, the engine is working it) but a required seat is still
 *        uncrewed and the trip is within `EXHAUSTED_THRESHOLD_HOURS` — boards
 *        **regardless of whether asks are in flight**. The operator needs to see
 *        every uncrewed near-term shift, not just the ones the automation has
 *        given up on; a live ask — or a nudge — no longer hides it (the old
 *        `asked > 0 && pending === 0` willingness gate is gone). The asymmetry
 *        is the time bound: "no one may" is urgent however far out; "still
 *        nobody crewed" becomes the operator's to watch within the deadline.
 *  - **regression** — a required seat is `Bailed` (DEC-019 makes resting-Bailed
 *    reachable only when the re-ask found an exhausted pool, so "can't
 *    auto-refill" is true by construction). Flagged independently of the
 *    resolved state — usually it also rides the resolved-`AtRisk` route, but a
 *    pre-horizon bail (an event date pushed later after a confirm-then-bail)
 *    boards too: a rested bail IS pool-exhaustion, and exhaustion summons
 *    immediately per the asymmetry above.
 *  - **credential_lapse** — a committed body (`Claimed`/`Confirmed`) whose
 *    hard-gating credential lapses before the trip date (`mmcValidOnDate`, the
 *    one boundary shared with the oracle). Checked on EVERY non-lifecycle
 *    shift, `Crewed` included — the headline case is precisely the boat that
 *    looks fine.
 *
 * A `Filling` shift whose trip is still beyond `EXHAUSTED_THRESHOLD_HOURS` does
 * NOT appear — the engine has runway and route (b)'s clock hasn't started
 * (eligibility-exhaustion still boards it early via route (a)). An event-less
 * shift (every event cancelled) has no horizon and no trip start: it can't board
 * via core (the resolve falls back to the seat-fold and the threshold has
 * nothing to count down to) and its time term is neutral — the cancel flow, not
 * this board, is what mops those up.
 *
 * Urgency is a flat additive blend (tune-later weights, DEC-025): time-to-trip
 * + pool-thinness + a regression constant. "Captain > mate" is expressed ONLY
 * as pool-thinness — the thinnest unfilled seat's remaining-candidate count —
 * never a role-name check (DEC-ROLE-1/DEC-025). Tests assert ordinal behavior
 * (sooner beats later; regression beats never-filled at similar time-to-trip;
 * thinner beats deeper), never exact scores, so the weights stay tunable.
 *
 * Scale note: each row costs one distinct-pool solve inside the trail plus one
 * `rankedEligible` per gap seat — repeated reads, no caching. Cheap at
 * BrewBoat's size; same revisit trigger as DEC-022/DEC-024 (an indexed,
 * DB-scale board read).
 */

import type { Seat } from "../domain/entities.js";
import type {
  CrewMemberId,
  RoleTypeId,
  ShiftId,
  VesselId,
} from "../domain/ids.js";
import type { ShiftState } from "../domain/states.js";
import type { Repository } from "../ports/repository.js";
import type { EscalationTrail } from "../asks/escalation-trail.js";
import { escalationTrailFor } from "../asks/escalation-trail.js";
import { rankedEligible } from "../asks/ask-loop.js";
import { mmcValidOnDate } from "../oracle/eligibility.js";
import {
  earliestScheduledStart,
  fillDeadlineFromEvents,
  resolveShiftState,
  scheduledStarts,
  staffingHorizonFromEvents,
  FILL_DEADLINE_HOURS,
  STAFFING_HORIZON_LEAD_DAYS,
} from "../builder/derive.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";

/**
 * How close (hours before trip start) a still-`Filling` shift with an uncrewed
 * required seat must be to land on the board (route (b) imminence, DEC-065).
 * **Definitionally the fill deadline** (DEC-031): one constant, so the row's
 * rendered "fills by" IS the instant this shift boards — the two can't drift.
 * Keep the bar high (SPEC §2.5), tune later. Eligibility-exhaustion (route (a))
 * ignores this entirely.
 */
export const EXHAUSTED_THRESHOLD_HOURS = FILL_DEADLINE_HOURS;

/**
 * Urgency bonus for a regression row, in time-term units (hours). A regression
 * outranks never-filled rows up to this much *closer* to their trip — SPEC
 * §2.5's "regressions sort above never-filled shifts of similar time-to-trip"
 * — without burying a trip leaving in 3 hours under a 6-days-out bail.
 */
export const REGRESSION_URGENCY = 72;

/**
 * Pool-thinness weight (DEC-025): the thinnest gap seat contributes
 * `THINNESS_WEIGHT / (1 + candidates)` — an empty pool reads like being a day
 * closer to the trip, a deep pool fades to noise.
 */
export const THINNESS_WEIGHT = 24;

/** Cosmetic offset so typical scores are positive; affects no ordering. */
const URGENCY_TIME_REF_HOURS = 14 * 24;

const MS_PER_HOUR = 60 * 60 * 1000;

export type AtRiskReason = "core" | "regression" | "credential_lapse";

/** One role's unfilled-required-seat count — the "1 captain / 1 mate / both". */
export interface RoleGap {
  role: RoleTypeId;
  missing: number;
}

/** One board row — everything #42 renders, no further derivation needed. */
export interface AtRiskRow {
  shiftId: ShiftId;
  vesselId: VesselId;
  /** ISO-8601 shift date. */
  date: string;
  /** State resolved on read (DEC-023), not the persisted badge. */
  resolvedState: ShiftState;
  /** Why this shift is here — non-empty, may carry several. */
  reasons: AtRiskReason[];
  /** What's missing, per role. Empty on a credential-lapse-only row. */
  gaps: RoleGap[];
  /** Earliest scheduled departure; null when no event anchors the shift. */
  tripStart: Date | null;
  /**
   * Every scheduled departure, earliest first (#59) — a multi-trip day carries
   * both/all times, where `tripStart` is just `[0]`. Empty when no event anchors
   * the shift.
   */
  tripStarts: Date[];
  /**
   * The "fills by" deadline (DEC-031): `tripStart − FILL_DEADLINE_HOURS`, the
   * instant this shift becomes a human problem — definitionally the willingness-
   * exhaustion boarding instant. `null` when no event anchors the shift (render
   * as absence, never faked). May be **past** — render as overdue, never clamped
   * (an exhaustion row boards only after it passes).
   */
  fillsBy: Date | null;
  /** The staffing horizon (DEC-022); null when no event anchors the shift. */
  horizon: Date | null;
  /** Hours from `now` to `tripStart`; null when `tripStart` is null. */
  hoursToTrip: number | null;
  /** The transparency trail (DEC-024) — proof the automation tried. */
  trail: EscalationTrail;
  /**
   * Committed bodies (Claimed/Confirmed) whose hard-gating credential lapses
   * before the trip — the *who* behind a `credential_lapse` reason, so the row
   * can name the problem ("Gus's MMC expires before the trip"). Empty otherwise.
   */
  credentialLapsed: CrewMemberId[];
  /**
   * Who's still actually LEAN-able (§2.5, #43): the union of the lean-able
   * seats' (Open/Bailed — not Asked, which has an ask in flight) eligible
   * pools, per-seat reliability order, deduped. Decliners stay in — leaning on
   * a "no" is Spink's call, and the trail shows the declines. **Bailers and
   * live-ask holders are out** — the re-ask already excludes bailers (DEC-019)
   * and a mid-flight person is already deciding; `lean()` enforces the same
   * set, so the board never offers a name the action would refuse.
   */
  available: CrewMemberId[];
  /** The additive urgency blend — sort key, most-urgent first. */
  urgencyScore: number;
}

/** Group a row's gap seats into per-role missing counts. */
function roleGaps(gapSeats: Seat[]): RoleGap[] {
  const byRole = new Map<RoleTypeId, number>();
  for (const s of gapSeats) byRole.set(s.role, (byRole.get(s.role) ?? 0) + 1);
  return [...byRole.entries()].map(([role, missing]) => ({ role, missing }));
}

/**
 * Derive the At-Risk board as of `now` — see the module doc for membership and
 * ordering. `opts.leadDays` / `opts.deadlineHours` override the horizon lead
 * (DEC-022) and the willingness threshold for tests/tuning.
 */
export async function deriveAtRiskBoard(
  repo: Repository,
  now: Date,
  opts?: { leadDays?: number; deadlineHours?: number; tz?: string },
): Promise<AtRiskRow[]> {
  const leadDays = opts?.leadDays ?? STAFFING_HORIZON_LEAD_DAYS;
  const deadlineHours = opts?.deadlineHours ?? EXHAUSTED_THRESHOLD_HOURS;
  const tz = opts?.tz ?? TENANT_TIMEZONE;
  const allEvents = await repo.listEvents();
  const rows: AtRiskRow[] = [];

  for (const shift of await repo.listShifts()) {
    // Lifecycle states are terminal — mirrors tick's guard.
    if (shift.state === "Cancelled" || shift.state === "Completed") continue;

    const ids = new Set(shift.eventIds);
    const events = allEvents.filter((e) => ids.has(e.id));
    const tripStart = earliestScheduledStart(events, tz);
    // Past-trip guard (#147, DEC-062): a departed shift drops off the board too —
    // shares tick's work-loop rule so board membership and engine work agree (no
    // pinging Spink about a trip that already left). A shift with no scheduled
    // event has no departure → falls through.
    if (tripStart !== null && tripStart.getTime() <= now.getTime()) continue;

    const seats = await repo.listSeatsForShift(shift.id);
    const required = seats.filter((s) => s.kind === "required");

    // One solve per shift: the trail's `exhausted` IS the oracle's verdict, so
    // the resolve below reuses it instead of calling solveShift again.
    const trail = await escalationTrailFor(repo, shift.id, now);

    const horizon = staffingHorizonFromEvents(events, leadDays, tz);
    const tripStarts = scheduledStarts(events, tz);
    // Same `deadlineHours` the willingness-exhaustion route boards on below, so
    // the rendered "fills by" IS that boarding instant (DEC-031).
    const fillsBy = fillDeadlineFromEvents(events, deadlineHours, tz);
    const hoursToTrip =
      tripStart === null
        ? null
        : (tripStart.getTime() - now.getTime()) / MS_PER_HOUR;

    // poolExhausted mirrors tick's poolExhaustedFor: a fully-confirmed shift is
    // never exhausted, whatever the solve says about a lapsed assignee.
    const unconfirmed = required.filter((s) => s.state !== "Confirmed");
    const poolExhausted = unconfirmed.length > 0 && trail.exhausted;
    const resolvedState = resolveShiftState(seats, {
      now,
      horizon,
      poolExhausted,
    });

    // Gap = required seats holding no committed body (Open/Asked/Bailed —
    // Claimed is a yes awaiting confirm, not a hole to fill).
    const gapSeats = required.filter(
      (s) => s.state !== "Confirmed" && s.state !== "Claimed",
    );

    const reasons: AtRiskReason[] = [];
    if (resolvedState === "AtRisk") {
      reasons.push("core"); // route (a): eligibility-exhausted / rested-Bailed — boards however far out
    } else if (
      resolvedState === "Filling" &&
      gapSeats.length > 0 &&
      hoursToTrip !== null &&
      hoursToTrip <= deadlineHours
    ) {
      // route (b) — imminence (DEC-065): uncrewed required seat within the fill
      // deadline, boards regardless of in-flight asks. The pending/asked gate is
      // gone — a live ask (or a nudge) no longer hides a near-term uncrewed shift.
      reasons.push("core");
    }

    if (required.some((s) => s.state === "Bailed")) reasons.push("regression");

    // Credential-lapse on committed bodies — every shift, Crewed included.
    // Same boundary as the oracle's gate: a date-only ISO-string comparison
    // (mmcValidOnDate), timezone-invariant by construction (DEC-032).
    const credentialLapsed: CrewMemberId[] = [];
    for (const seat of required) {
      if (!seat.assignedCrewMemberId) continue;
      if (seat.state !== "Claimed" && seat.state !== "Confirmed") continue;
      const creds = await repo.listCredentialsForCrew(seat.assignedCrewMemberId);
      if (!mmcValidOnDate(creds, shift.date).passed) {
        credentialLapsed.push(seat.assignedCrewMemberId);
      }
    }
    if (credentialLapsed.length > 0) reasons.push("credential_lapse");

    if (reasons.length === 0) continue;

    // The lean-exclusion set, mirrored exactly by `lean()` — one definition of
    // "leanable" so the board never renders a button the action rejects:
    //  - bailed on THIS shift (matches the re-ask's own exclusion, DEC-019);
    //  - holding a live (unanswered) ask on this shift — already deciding.
    // The bailer scan walks the crew-keyed log (same pattern + same M4-index
    // revisit as escalate's already-nudged scan).
    const excluded = new Set<CrewMemberId>();
    for (const crew of await repo.listCrewMembers()) {
      const events = await repo.reliabilityEventsFor(crew.id);
      if (
        events.some(
          (e) => e.type === "shift_bailed" && e.metadata.shiftId === shift.id,
        )
      ) {
        excluded.add(crew.id);
      }
    }
    for (const seat of required) {
      for (const ask of await repo.listAsksForSeat(seat.id)) {
        if (ask.respondedAt === undefined) excluded.add(ask.crewMemberId);
      }
    }

    // Per-seat eligible pools over the LEAN-able seats only (Open/Bailed — an
    // Asked seat has an ask in flight and takes no lean): feed both
    // `available` and the thinness term.
    const leanSeats = required.filter(
      (s) => s.state === "Open" || s.state === "Bailed",
    );
    const available: CrewMemberId[] = [];
    const seen = new Set<CrewMemberId>();
    let minPool: number | null = null;
    for (const seat of leanSeats) {
      const pool = await rankedEligible(repo, seat, now, excluded);
      minPool = minPool === null ? pool.length : Math.min(minPool, pool.length);
      for (const c of pool) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          available.push(c.id);
        }
      }
    }

    // The additive blend (DEC-025). Time term is unclamped so "sooner beats
    // later" stays strictly monotone even past the cosmetic reference point.
    const timeTerm =
      hoursToTrip === null ? 0 : URGENCY_TIME_REF_HOURS - hoursToTrip;
    const thinnessTerm =
      minPool === null ? 0 : THINNESS_WEIGHT / (1 + minPool);
    const regressionTerm = reasons.includes("regression")
      ? REGRESSION_URGENCY
      : 0;
    const urgencyScore = timeTerm + thinnessTerm + regressionTerm;

    rows.push({
      shiftId: shift.id,
      vesselId: shift.vesselId,
      date: shift.date,
      resolvedState,
      reasons,
      gaps: roleGaps(gapSeats),
      tripStart,
      tripStarts,
      fillsBy,
      horizon,
      hoursToTrip,
      trail,
      credentialLapsed,
      available,
      urgencyScore,
    });
  }

  // Most-urgent first; shiftId tie-break keeps the order deterministic across
  // adapters (listShifts order is unspecified).
  return rows.sort(
    (a, b) =>
      b.urgencyScore - a.urgencyScore ||
      String(a.shiftId).localeCompare(String(b.shiftId)),
  );
}
