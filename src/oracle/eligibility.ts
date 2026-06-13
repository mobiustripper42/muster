/**
 * The crew-eligibility rules (SPEC §1.3, DEC-003).
 *
 * Pure: no I/O, no clock read (`now` is injected). Each rule reads a slice of
 * state and returns a structured `RuleResult` — `reason` is a **payload, not a
 * sentence** (§1.3), because the admin views need per-candidate detail.
 *
 * These are the **hard** crew rules — the ones that gate the eligible pool. They
 * are deliberately NOT independent booleans evaluated across the whole pool: each
 * is a fact about one *candidate*. The composite shared-pool solve that turns a
 * set of per-candidate verdicts into "can this whole shift be crewed?" lives in
 * `oracle.ts` (DEC-003 — the false-yes the naive shape produces is avoided there,
 * not here).
 *
 * Out of scope for 1.4a (homed at 1.4b/M3): the two-horizon machinery (§1.3 — a
 * rule outside its staffing horizon *abstains* rather than fails). Here every
 * rule evaluates eagerly; the caller decides when the pool is worth computing.
 */

import type { Credential, CrewMember, PtoWindow } from "../domain/entities.js";
import type { CredentialType } from "../domain/entities.js";
import type { CrewMemberId, RoleTypeId } from "../domain/ids.js";

/**
 * Credential types that HARD-gate the eligible pool in v1. MMC only.
 *
 * This applies to **every** crewing role, not just captains — and that is
 * deliberate, not a captain-only rule misapplied. SPEC §2.1: "**MMC is
 * universal**" — every mariner holds one (the seed gives all crew an MMC), so a
 * lapsed MMC drops anyone from any pool. The acceptance criterion is itself
 * role-agnostic: "a crew member with an MMC expiring before a trip date does not
 * appear in that trip's eligible pool." A role→required-credential *mapping*
 * (which would let a tenant say "mates need X") is DEC-ROLE-1 tenant data and a
 * later concern; hardcoding `role === "captain"` here would reintroduce the very
 * enum DEC-ROLE-1 forbids.
 *
 * medical / TWIC / drug-consortium are tenant-configurable **soft / "M"** rules
 * shipped warn-only or omitted for BrewBoat v1 (§1.3) — not eligibility gates.
 * Named + overridable so a tenant can promote one later without a code change
 * (DEC-001).
 */
export const HARD_CREDENTIAL_TYPES: readonly CredentialType[] = ["MMC"];

/** Stable rule identifiers — the admin views key off these, never the prose. */
export type EligibilityRuleId =
  | "is_active"
  | "has_rating"
  | "mmc_valid_on_date"
  | "not_double_booked"
  | "not_on_pto";

/**
 * One rule's verdict. `severity` is always `"hard"` here — every eligibility rule
 * gates. `details` is the structured reason payload (§1.3): the shape varies per
 * rule, the admin renders it. Absent on a pass.
 */
export interface RuleResult {
  ruleId: EligibilityRuleId;
  passed: boolean;
  severity: "hard";
  details?: Record<string, unknown>;
}

/** A candidate's full eligibility verdict for one seat (role + trip date). */
export interface CandidateVerdict {
  crewMemberId: CrewMemberId;
  /** True iff every hard rule passed. */
  eligible: boolean;
  /** Only the FAILED rules, with structured reasons — the "why each failed". */
  failures: RuleResult[];
}

const pass = (ruleId: EligibilityRuleId): RuleResult => ({
  ruleId,
  passed: true,
  severity: "hard",
});

const fail = (
  ruleId: EligibilityRuleId,
  details: Record<string, unknown>,
): RuleResult => ({ ruleId, passed: false, severity: "hard", details });

// ── Individual rules ────────────────────────────────────────────────────────

/** Inactive crew are out of every future pool (SPEC §2.1). */
export function isActive(crew: CrewMember): RuleResult {
  return crew.status === "active"
    ? pass("is_active")
    : fail("is_active", { status: crew.status });
}

/** Candidate's ratings include the seat's role (DEC-ROLE-1). */
export function hasRating(crew: CrewMember, role: RoleTypeId): RuleResult {
  return crew.ratings.includes(role)
    ? pass("has_rating")
    : fail("has_rating", { required: role, held: crew.ratings });
}

/**
 * Candidate holds a hard-gating credential valid on the trip date (§1.3).
 *
 * Pure **date-only** comparison of ISO date strings (`tripDate` = the shift's
 * `date`, `c.expiry` = a date-only ISO string): valid iff `expiry >= tripDate`.
 * ISO `YYYY-MM-DD` sorts lexicographically identical to chronologically, so this
 * is **timezone-invariant by construction** (DEC-032) — no `new Date`, no
 * midnight-UTC vs vessel-midnight day-shift. The credential question is "is the
 * expiry day on or after the trip day," which is a calendar-date fact, not an
 * instant. (`credential-health.ts`'s soft "expires in N days" nudge stays a
 * days-grained advisory and is intentionally not date-string-exact.)
 */
export function mmcValidOnDate(
  credentials: Credential[],
  tripDate: string,
): RuleResult {
  const gating = credentials.filter((c) =>
    HARD_CREDENTIAL_TYPES.includes(c.type),
  );
  const validOne = gating.find((c) => c.expiry >= tripDate);
  if (validOne) return pass("mmc_valid_on_date");
  return fail("mmc_valid_on_date", {
    required: HARD_CREDENTIAL_TYPES,
    tripDate,
    // Surface what they DO hold so the admin sees "MMC expired 2026-05" vs "none".
    held: gating.map((c) => ({ type: c.type, expiry: c.expiry })),
  });
}

/**
 * Candidate is not already committed elsewhere the same day (§1.3 "crew not
 * double-booked same slot").
 *
 * ⚠️ SIMPLIFICATION (revisit at 1.4b): conflict is **day-grained**, not
 * time-slot-grained. A person committed to any other shift on the trip date is
 * double-booked, regardless of departure times — a person can't be on two boats
 * the same day. Turnaround-buffer / same-slot overlap is a separate relational
 * rule (§1.3, soft) that the time-aware oracle adds later.
 *
 * `committedDates` is the set of ISO dates the candidate already holds a seat on
 * (computed by the repo-backed caller). The current shift's own date is expected
 * to be excluded by the caller before this runs.
 */
export function notDoubleBooked(
  committedDates: ReadonlySet<string>,
  tripDate: string,
): RuleResult {
  return committedDates.has(tripDate)
    ? fail("not_double_booked", { conflictDate: tripDate })
    : pass("not_double_booked");
}

/**
 * Trip date falls outside every PTO window (DEC-009 suppression-only). Windows
 * are inclusive date spans; a date on the boundary counts as blocked.
 */
export function notOnPto(
  windows: PtoWindow[],
  tripDate: string,
): RuleResult {
  const hit = windows.find((w) => tripDate >= w.start && tripDate <= w.end);
  return hit
    ? fail("not_on_pto", { window: { start: hit.start, end: hit.end } })
    : pass("not_on_pto");
}

// ── Composite per-candidate verdict ─────────────────────────────────────────

/** The state slice one candidate's evaluation needs. Assembled by the caller. */
export interface CandidateContext {
  crew: CrewMember;
  credentials: Credential[];
  ptoWindows: PtoWindow[];
  /** ISO dates this candidate already holds a committed seat on (excl. this shift). */
  committedDates: ReadonlySet<string>;
}

/**
 * Evaluate every hard rule for one candidate against one seat. Runs all rules
 * (collect-all mode — the admin reschedule view wants every reason, §1.3), then
 * reports `eligible` plus the structured failures.
 */
export function evaluateCandidate(
  ctx: CandidateContext,
  role: RoleTypeId,
  tripDate: string,
): CandidateVerdict {
  const results = [
    isActive(ctx.crew),
    hasRating(ctx.crew, role),
    mmcValidOnDate(ctx.credentials, tripDate),
    notDoubleBooked(ctx.committedDates, tripDate),
    notOnPto(ctx.ptoWindows, tripDate),
  ];
  const failures = results.filter((r) => !r.passed);
  return {
    crewMemberId: ctx.crew.id,
    eligible: failures.length === 0,
    failures,
  };
}
