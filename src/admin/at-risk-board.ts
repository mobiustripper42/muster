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
 *  - **core** — the engine is out of moves. Two routes, deliberately asymmetric:
 *    (a) the shift *resolves* `AtRisk` (eligibility-exhaustion: nobody CAN
 *        legally crew it, or a required seat rests `Bailed` — DEC-019/022) —
 *        summoned immediately, however far out the trip is; or
 *    (b) **willingness-exhaustion**: the shift still resolves `Filling` because
 *        eligible people exist, but everyone asked said no or went silent
 *        (`asked > 0`, `pending === 0`, still short) — this only boards once the
 *        trip is within `EXHAUSTED_THRESHOLD_HOURS`, because a late yes can
 *        still save it without Spink. The asymmetry is the anti-anxiety-
 *        dashboard line: "no one may" is urgent now; "no one wants to" is
 *        urgent close to the dock.
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
 * A shift still actively worked — a live ask in flight, or willingness-
 * exhausted but the trip far off — does NOT appear. An event-less shift (every
 * event cancelled) has no horizon and no trip start: it can't board via core
 * (the resolve falls back to the seat-fold and the threshold has nothing to
 * count down to) and its time term is neutral — the cancel flow, not this
 * board, is what mops those up.
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
  resolveShiftState,
  staffingHorizonFromEvents,
  STAFFING_HORIZON_LEAD_DAYS,
} from "../builder/derive.js";

/**
 * How close (hours before trip start) a willingness-exhausted shift must be to
 * land on the board. The DEC-TBD "'Exhausted' threshold" knob — keep the bar
 * high (SPEC §2.5), tune later. Eligibility-exhaustion ignores this entirely.
 */
export const EXHAUSTED_THRESHOLD_HOURS = 48;

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
  /** The staffing horizon (DEC-022); null when no event anchors the shift. */
  horizon: Date | null;
  /** Hours from `now` to `tripStart`; null when `tripStart` is null. */
  hoursToTrip: number | null;
  /** The transparency trail (DEC-024) — proof the automation tried. */
  trail: EscalationTrail;
  /**
   * Who's still theoretically available for a manual lean (§2.5): the union of
   * the gap seats' eligible pools, per-seat reliability order, deduped.
   * Decliners stay in — leaning on a "no" is Spink's call, and the trail shows
   * the declines. **Bailers are out** — the engine's own re-ask already
   * excludes them (DEC-019), and offering the person who just walked, unmarked,
   * is a trap, not an option.
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
  opts?: { leadDays?: number; deadlineHours?: number },
): Promise<AtRiskRow[]> {
  const leadDays = opts?.leadDays ?? STAFFING_HORIZON_LEAD_DAYS;
  const deadlineHours = opts?.deadlineHours ?? EXHAUSTED_THRESHOLD_HOURS;
  const allEvents = await repo.listEvents();
  const rows: AtRiskRow[] = [];

  for (const shift of await repo.listShifts()) {
    // Lifecycle states are terminal — mirrors tick's guard.
    if (shift.state === "Cancelled" || shift.state === "Completed") continue;

    const seats = await repo.listSeatsForShift(shift.id);
    const required = seats.filter((s) => s.kind === "required");

    // One solve per shift: the trail's `exhausted` IS the oracle's verdict, so
    // the resolve below reuses it instead of calling solveShift again.
    const trail = await escalationTrailFor(repo, shift.id, now);

    const ids = new Set(shift.eventIds);
    const events = allEvents.filter((e) => ids.has(e.id));
    const horizon = staffingHorizonFromEvents(events, leadDays);
    const tripStart = earliestScheduledStart(events);
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
      reasons.push("core"); // route (a): eligibility-exhausted / rested-Bailed
    } else if (
      resolvedState === "Filling" &&
      trail.asked > 0 &&
      trail.pending === 0 &&
      gapSeats.length > 0 &&
      hoursToTrip !== null &&
      hoursToTrip <= deadlineHours
    ) {
      reasons.push("core"); // route (b): willingness-exhausted, deadline closing
    }

    if (required.some((s) => s.state === "Bailed")) reasons.push("regression");

    // Credential-lapse on committed bodies — every shift, Crewed included.
    // Same boundary as the oracle's gate (mmcValidOnDate at date-only 00:00Z).
    const tripDate = new Date(shift.date);
    for (const seat of required) {
      if (!seat.assignedCrewMemberId) continue;
      if (seat.state !== "Claimed" && seat.state !== "Confirmed") continue;
      const creds = await repo.listCredentialsForCrew(seat.assignedCrewMemberId);
      if (!mmcValidOnDate(creds, tripDate).passed) {
        reasons.push("credential_lapse");
        break;
      }
    }

    if (reasons.length === 0) continue;

    // Who bailed on THIS shift — excluded from `available` to match the
    // re-ask's own exclusion (DEC-019). Crew-keyed log, so scan the roster
    // filtering on `metadata.shiftId` (same pattern + same M4-index revisit as
    // escalate's already-nudged scan).
    const bailers = new Set<CrewMemberId>();
    for (const crew of await repo.listCrewMembers()) {
      const events = await repo.reliabilityEventsFor(crew.id);
      if (
        events.some(
          (e) => e.type === "shift_bailed" && e.metadata.shiftId === shift.id,
        )
      ) {
        bailers.add(crew.id);
      }
    }

    // Per-gap-seat eligible pools: feed both `available` and the thinness term.
    const available: CrewMemberId[] = [];
    const seen = new Set<CrewMemberId>();
    let minPool: number | null = null;
    for (const seat of gapSeats) {
      const pool = await rankedEligible(repo, seat, now, bailers);
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
      horizon,
      hoursToTrip,
      trail,
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
