/**
 * The two nested state machines (SPEC §1.1).
 *
 * Model them separately; the shift state is *derived* from its seats (DEC-005).
 * This file declares the vocabulary only — no transition logic. The legal edges
 * and the derivation live with M2 (task 1.3), not here.
 */

// ── Shift states ────────────────────────────────────────────────────────────

export const SHIFT_STATES = [
  "Pending", // booked, staffing horizon not yet reached — crew rules abstain
  "Filling", // horizon crossed; system is working it (Tiers 1–2), 0..n seats filled
  "Crewed", // every *required* seat confirmed (supernumeraries do not gate)
  "AtRisk", // escalation exhausted, still short, trip closing in — human-only
  "Completed", // trip ran; feeds reliability scores
  "Cancelled", // killed — booking cancelled, or couldn't crew and Eric pulled the plug
] as const;

export type ShiftState = (typeof SHIFT_STATES)[number];

// ── Seat sub-states ─────────────────────────────────────────────────────────

/**
 * ⏳ RESERVED (DEC-005, SPEC §1.1): a `Held` tier — weaker than `Confirmed`,
 * stronger than `Asked` — belongs between `Claimed` and `Confirmed` for Pass D
 * (progressive commitment). It is deliberately ABSENT from the live union so v1
 * cannot accidentally produce it. To add it later, insert `"Held"` at the marked
 * position below and extend the seat machine — no other state needs restructuring.
 * An all-`Held` shift stays `Filling`; no new shift state is introduced.
 */
export const SEAT_STATES = [
  "Open", // needs a person; eligible pool computed
  "Asked", // ask is out, awaiting response
  "Claimed", // accepted (ask-then-assign) or assigned (assign-then-confirm); tentative
  /* ⏳ "Held"  ← Pass D insertion point (DEC-005) — do not enable in v1 */
  "Confirmed", // locked to a specific person
  "Bailed", // a confirmed person backed out; seat returns to Open
] as const;

export type SeatState = (typeof SEAT_STATES)[number];

// ── Seat shape (required vs supernumerary) ──────────────────────────────────

export const SEAT_KINDS = ["required", "supernumerary"] as const;
export type SeatKind = (typeof SEAT_KINDS)[number];

// Crew roles are NOT a fixed enum (DEC-ROLE-1). A seat demands a `RoleTypeId`
// referencing a tenant-defined `RoleType` row (see entities.ts) — never a
// `"captain" | "mate"` literal. "captain"/"mate" exist only as seeded data.
