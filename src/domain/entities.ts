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
 *   Vessel → Event / Shift; Vessel.manning & Seat.role & CrewMember.ratings → RoleType
 *   Tenant → RoleType (1:n)   (roles are tenant data, not an enum — DEC-ROLE-1)
 */

import type {
  AskId,
  CredentialId,
  CrewMemberId,
  EventId,
  MagicTokenId,
  OutboxEntryId,
  PtoWindowId,
  ReservationId,
  RoleTypeId,
  SeatId,
  ShiftId,
  TenantId,
  VesselId,
} from "./ids.js";
import type { SeatKind, SeatState, ShiftState } from "./states.js";

// ── RoleType (tenant configuration — DEC-ROLE-1) ────────────────────────────

/**
 * A crew role/rating type, defined PER TENANT as data — never a language enum
 * (DEC-ROLE-1). BrewBoat seeds two rows ("captain", "mate"); a later tenant adds
 * deckhand / engineer / naturalist by adding rows, no code change. The slice
 * seeds these via fixture; a role-admin UI is a multi-tenant-era concern.
 */
export interface RoleType {
  id: RoleTypeId;
  /** The owning tenant. Single-tenant in the slice; broader scoping deferred. */
  tenantId: TenantId;
  /** Human label, e.g. "captain", "mate". Display only — never branched on. */
  name: string;
}

// ── Vessel ──────────────────────────────────────────────────────────────────

/**
 * One line of a vessel's manning rule: how many of a given role the COI requires.
 * Seat derivation iterates this list (DEC-ROLE-1) — it must work for N lines, not
 * assume two. BrewBoat = [{captain,1}, {mate,1}].
 */
export interface ManningRequirement {
  roleTypeId: RoleTypeId;
  count: number;
}

export interface Vessel {
  id: VesselId;
  name: string;
  /** Certificate-of-Inspection max passengers. BrewBoat = 6. */
  coiMaxPax: number;
  /** The manning rule as a list; the seat builder loops it (DEC-ROLE-1). */
  manning: ManningRequirement[];
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
  /**
   * Which roles this person can fill — a set of `RoleTypeId` (DEC-ROLE-1), not
   * an enum. Trainee = unrated, rides a supernumerary seat to build hours.
   */
  ratings: RoleTypeId[];
  status: CrewStatus;
  /** Spink's manual thumb (§1.4): boost or floor. The score itself is not hand-edited. */
  manualBoost?: number;
  manualFloor?: number;
  protocolOverride?: ProtocolOverride;
  /**
   * Computed standing (§1.4). MVP-thin: null until populated. Cold-start crew
   * read neutral/mid-pool, NOT a misleading low — `null` ("no history yet"),
   * distinct from a real low number.
   *
   * DISPLAY-ONLY. Ask-order ranking is derived live from the reliability log
   * (`rankByReliability`), not from this field. Reconciling the display read
   * (crew-view/roster) to the same log-derived score is #32 — until then this
   * stays null/flat (DEC-008) and the two don't diverge in practice.
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
  /**
   * Where this event departs from — a place name/address the shift card turns
   * into a tappable map pin (SPEC §2.6.3). Per-EVENT, not per-vessel: the same
   * boat can leave different docks on different events. Optional (imported events
   * may not carry it yet → no pin).
   */
  dock?: string;
}

export type ReservationStatus = "booked" | "cancelled";

export interface Reservation {
  id: ReservationId;
  eventId: EventId;
  customerName: string;
  partySize: number;
  /**
   * Email is the manifest spine and the customers-export join key (DEC-017) —
   * inline on every Xola reservation. Optional because manual/legacy entries may
   * lack it.
   */
  email?: string;
  /**
   * Phone is **nullable** (DEC-017): it's not on the reservation row — it's
   * joined in from the customers export. A missing phone degrades one manifest
   * card; it never fails the import.
   */
  phone?: string;
  status: ReservationStatus;
  /**
   * When this reservation was created or last *materially* changed (ISO-8601 UTC).
   * Stamped by the import on create + material change only (DEC-029) — the
   * comparand for the builder's "changed since you reviewed it" nudge
   * (`max(updatedAt) > shift.lockedAt`). Optional: absent = predates tracking →
   * older than any lock → never nudges (no backfill needed).
   */
  updatedAt?: string;
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
  /** The role this seat demands — a `RoleTypeId` reference (DEC-ROLE-1), not an enum. */
  role: RoleTypeId;
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
  /** ⏳ Pass D (DEC-004). Omitted in v1; absence reads as "confirm". */
  type?: AskType;
  /** ⏳ Pass D (DEC-004): the horizon by which a hold must harden. Inert in v1. */
  decisionBy?: string;
}

// ── MagicToken (self-rolled magic-link auth — DEC-010, DEC-020) ──────────────

/**
 * Who a magic link authenticates. Crew links carry a `CrewMemberId`; the admin
 * (Spink) link carries an operator identifier (email/handle) — there is no admin
 * entity yet, so `subjectId` is a plain string the surface layer interprets per
 * `kind`. Same mechanism for both (DEC-020).
 */
export type AuthSubjectKind = "admin" | "crew";

/**
 * A single-use, short-lived magic-link credential. Only the **hash** of the link
 * secret is ever stored (`tokenHash`) — a DB leak yields no usable links. Verify
 * re-hashes the presented secret, finds this row, and consumes it via a port CAS
 * (`consumeMagicTokenIfUnused`) so a replayed link can't be redeemed twice.
 *
 * This is the link, not the session. A successful verify lets the surface layer
 * (1.5b) mint a longer-lived, renewable session; that session + its storage on
 * the PWA/native client is out of scope here. `issue`→`verify` is the seam.
 */
export interface MagicToken {
  id: MagicTokenId;
  /** sha256 of the raw link secret (hex). The secret itself is never stored. */
  tokenHash: string;
  subjectKind: AuthSubjectKind;
  subjectId: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** ISO-8601 UTC. Past this instant the link is dead even if unconsumed. */
  expiresAt: string;
  /** ISO-8601 UTC; absent until redeemed. Single-use: set once, by the CAS. */
  consumedAt?: string;
}

// ── OutboxEntry (channel-adapter state — DEC-030) ────────────────────────────

/** `pending` = the operator hasn't texted it yet; `sent` = they marked it sent. */
export type OutboxStatus = "pending" | "sent";

/**
 * One queued relay for the web-link pilot channel (DEC-030, DEC-MSG-3): the
 * adapter's `send` enqueues this instead of transmitting, and the operator works
 * the outbox page — tap the `sms:` link, text it, mark it sent.
 *
 * **Adapter-side state, never domain state** (the DEC-030 hard guardrail):
 * nothing in `src/asks`, `src/builder`, or `src/oracle` may read it. The domain
 * `Ask` is unchanged — that's what keeps the eventual Twilio swap a zero-domain-
 * change adapter drop-in (DEC-MSG-1). `body` + `link` are minted ONCE at enqueue
 * and rendered verbatim forever (a page refresh must never re-mint and desync
 * from what was already texted). `sentAt` is the operator's physical text, a
 * channel-side fact only; the domain's delivery stamp is `createdAt` (enqueue).
 */
export interface OutboxEntry {
  id: OutboxEntryId;
  askId: AskId;
  seatId: SeatId;
  crewMemberId: CrewMemberId;
  /** The ask text the operator relays, frozen at enqueue. */
  body: string;
  /** The magic link (24h TTL) to the In/Out screen, minted + frozen at enqueue. */
  link: string;
  status: OutboxStatus;
  /** ISO-8601 UTC — enqueue time, and the channel's `deliveredAt`. */
  createdAt: string;
  /** ISO-8601 UTC; set when the operator marks it sent. Channel-side only. */
  sentAt?: string;
}

export type { ReliabilityEvent } from "./reliability.js";
