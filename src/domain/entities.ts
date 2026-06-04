/**
 * SPEC §2 entity types — the stack-agnostic data model (DEC-013).
 *
 * Pure types: no behavior, no persistence, no framework. Fields marked
 * "(log day one)" must be real from the first commit even if nothing reads them
 * yet (DEC-008). Fields marked ⏳ are reserved for Pass D (DEC-004/005) — present
 * but inert in v1.
 *
 *   Reservation → Event (n:1) → Shift (n:1, by vessel+day) → Seat (1:n)
 *   CrewMember → Credential / PtoWindow / ReliabilityEvent (1:n)
 *   Vessel → Event / Shift
 */

import type {
  AskId,
  CredentialId,
  CrewMemberId,
  EventId,
  PtoWindowId,
  ReservationId,
  SeatId,
  ShiftId,
  VesselId,
} from "./ids.js";
import type { CrewRole, SeatKind, SeatState, ShiftState } from "./states.js";

// ── Vessel ──────────────────────────────────────────────────────────────────

/** Per-role headcount the COI/manning requires. BrewBoat = {captain:1, mate:1}. */
export interface Manning {
  captain: number;
  mate: number;
}

export interface Vessel {
  id: VesselId;
  name: string;
  /** Certificate-of-Inspection max passengers. BrewBoat = 6. */
  coiMaxPax: number;
  manning: Manning;
}

// ── CrewMember + sub-records ────────────────────────────────────────────────

export type CrewStatus = "active" | "inactive";

/**
 * MMC is universal (captain gating, 5-yr renewal). medical / TWIC /
 * drug-consortium are tenant-configurable (oracle's "M" rules, §1.3). Kept open
 * as a string so a tenant can turn on a type without a code change.
 */
export type CredentialType =
  | "MMC"
  | "medical"
  | "TWIC"
  | "drug_consortium"
  | (string & {});

export interface Credential {
  id: CredentialId;
  crewMemberId: CrewMemberId;
  type: CredentialType;
  identifier?: string;
  /** ISO-8601 date. "Ages out" = expires, not retires. */
  expiry: string;
}

/** Suppression-only by design (DEC-009): absence of a window means available. */
export interface PtoWindow {
  id: PtoWindowId;
  crewMemberId: CrewMemberId;
  /** ISO-8601. Inclusive blackout span. */
  start: string;
  end: string;
}

/** Per-person override of the per-role ask protocol default (§1.2). */
export type ProtocolOverride = "ask_then_assign" | "assign_then_confirm";

export interface CrewMember {
  id: CrewMemberId;
  name: string;
  /** SMS/push target and magic-link destination. */
  phone: string;
  email?: string;
  /** Which seats this person can fill. Trainee = unrated, rides a supernumerary seat. */
  ratings: CrewRole[];
  status: CrewStatus;
  /** Spink's manual thumb (§1.4): boost or floor. The score itself is not hand-edited. */
  manualBoost?: number;
  manualFloor?: number;
  protocolOverride?: ProtocolOverride;
  /**
   * Computed standing (§1.4). MVP-thin: null until a scorer exists.
   * Cold-start crew read neutral/mid-pool, NOT a misleading low — represented
   * here as `null` ("no history yet"), distinct from a real low number.
   */
  reliabilityScore: number | null;
}

// ── Event + Reservation ─────────────────────────────────────────────────────

export type EventStatus = "scheduled" | "cancelled";

export interface Event {
  id: EventId;
  vesselId: VesselId;
  /** ISO-8601 date (vessel-local day). */
  date: string;
  /** Departure clock time, e.g. "14:00". */
  time: string;
  capacity: number;
  status: EventStatus;
}

export type ReservationStatus = "booked" | "cancelled";

export interface Reservation {
  id: ReservationId;
  eventId: EventId;
  customerName: string;
  partySize: number;
  phone: string;
  status: ReservationStatus;
  // No waiver field — DEC-012.
}

// ── Shift + Seat ────────────────────────────────────────────────────────────

export interface Shift {
  id: ShiftId;
  vesselId: VesselId;
  /** ISO-8601 date. Shifts group events by vessel + day. */
  date: string;
  /** Derived from seats (DEC-005); stored for query convenience. */
  state: ShiftState;
  lockedAt?: string;
  eventIds: EventId[];
}

export interface Seat {
  id: SeatId;
  shiftId: ShiftId;
  role: CrewRole;
  kind: SeatKind;
  state: SeatState;
  assignedCrewMemberId?: CrewMemberId;
}

// ── Ask ─────────────────────────────────────────────────────────────────────

/** Delivery channel (DEC-MSG): one channel port, many adapters. */
export type AskChannel = "push" | "sms";

export type AskResponse = "accepted" | "declined";

/**
 * ⏳ confirm vs hold: `hold` is RESERVED for Pass D progressive commitment
 * (DEC-004). v1 only ever issues `confirm`.
 */
export type AskType = "confirm" | "hold";

/**
 * An ask doubles as a reliability event (it spawns `ask_sent`, then
 * `ask_accepted`/`ask_declined`/`ask_ignored`).
 */
export interface Ask {
  id: AskId;
  seatId: SeatId;
  crewMemberId: CrewMemberId;
  channel: AskChannel;
  /** ISO-8601 UTC. */
  sentAt: string;
  respondedAt?: string;
  response?: AskResponse;
  /** ⏳ Pass D (DEC-004). Defaults to "confirm" in v1. */
  type: AskType;
  /** ⏳ Pass D (DEC-004): the horizon by which a hold must harden. Inert in v1. */
  decisionBy?: string;
}

export type { ReliabilityEvent } from "./reliability.js";
