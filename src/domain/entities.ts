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
  PaymentId,
  PtoWindowId,
  ReservationId,
  RingOutboxEntryId,
  NoticeOutboxEntryId,
  SmsConsentId,
  RoleTypeId,
  SeatId,
  ShiftId,
  TenantId,
  ThreadId,
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

/**
 * Crew lifecycle (DEC-096, #323):
 *  - `active`   — in the ask pool + manually placeable.
 *  - `inactive` — NOT auto-asked (fails the `isActive` eligibility gate), but still
 *                 manually placeable via the cockpit override (a temporary bench).
 *  - `archived` — no longer with the operation: out of the ask pool AND out of the
 *                 manual override picker/guard — off every list. History is kept
 *                 (no hard delete); reversible via `db:crew unarchive`.
 */
export type CrewStatus = "active" | "inactive" | "archived";

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

/**
 * Coexistence discriminator (DEC-106): which system OWNS this event/reservation.
 * `'xola'` = imported from Xola (the importer structurally only ever writes this);
 * `'muster'` = a Muster-native reservation (the booking path sets it explicitly).
 * Plain text union, never a DB enum/CHECK — validation is the service layer's
 * (DEC-DATA-1), so the in-memory + Postgres adapters stay behaviorally identical.
 * A future source widens this in one line. Log day one (DEC-008): real from the
 * first commit even though the availability deriver (11.1) is the first reader.
 */
export type Source = "xola" | "muster";

export interface Event {
  id: EventId;
  vesselId: VesselId;
  /** ISO-8601 date (vessel-local day). */
  date: string;
  /** Departure clock time, e.g. "14:00". */
  time: string;
  capacity: number;
  status: EventStatus;
  /** Coexistence owner (DEC-106). Log day one; `'xola'` for every imported event. */
  source: Source;
  /**
   * Per-event price in integer CENTS (DEC-112) — Stripe-aligned, float-safe.
   * Optional + source-agnostic: `'xola'` events leave it undefined (their money
   * lives in Xola, DEC-105); the Muster booking path sets it. Phase 11 resolves
   * price from here directly — the Offering/schedule default-cascade is Phase 12.
   */
  price?: number;
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
  /** Coexistence owner (DEC-106). Log day one; `'xola'` for every imported reservation. */
  source: Source;
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
   * Liability-waiver consent (11.5, DEC-110) — Muster-SOLD side only. `waiverConsentAt`
   * is the ISO-8601 UTC instant the customer agreed (stamped at checkout-start, the
   * agreement moment); `waiverVersion` is the terms version they agreed to (server-
   * authoritative, from config — proves WHICH terms). Both absent on `source='xola'`
   * reservations (Xola owns its own waiver) and on any pre-11.5 Muster booking. A real
   * waiver-provider integration is P12; this is the minimal consent record, not a
   * subsystem.
   */
  waiverConsentAt?: string;
  waiverVersion?: string;
  /**
   * When this reservation was created or last *materially* changed (ISO-8601 UTC).
   * Stamped by the import on create + material change only (DEC-029). Optional:
   * absent = predates tracking. Retained as the raw change signal; a future
   * "changed since you last looked" cue may re-anchor on it or on Xola import
   * diffs (the lock-anchored nudge was retired with locking, DEC-082/#215).
   */
  updatedAt?: string;
  // No waiver field — DEC-012.
}

// ── Payment (Muster-native reservations only — DEC-107) ──────────────────────

/**
 * How a payment was taken. Only `stripe` (card via Checkout) is implemented; the
 * discriminator is log-day-one (DEC-008) so `cash` / `venmo` are a one-line widen
 * later, with no schema change — the `stripe*` ids below go unused for those.
 */
export type PaymentMethod = "stripe" | (string & {});

/** full = paid in one shot; deposit + balance = the two-part flow (DEC-107, 11.2b). */
export type PaymentKind = "full" | "deposit" | "balance";

/** `refunded` states exist for the record only — refunds are ALWAYS manual in the
 *  Stripe dashboard (operator decision); nothing in Muster issues a programmatic refund. */
export type PaymentStatus = "succeeded" | "refunded" | "partially_refunded";

/**
 * One money movement against a Muster-native reservation (DEC-107). A booking is a
 * 1:n money log — `full`, or `deposit` then `balance` — modeled as a separate append
 * record like every other Muster side-effect log (reliability, outbox, audit), NOT as
 * columns on `Reservation` (which is shared with Xola, whose money lives in Xola —
 * DEC-105/106; payment columns would sit null on every imported row). No FK
 * (DEC-DATA-1). Balance-due is DERIVED (`price + tax − Σ succeeded`), never stored.
 */
export interface Payment {
  /** Deterministic from the Stripe checkout-session id — idempotent write. */
  id: PaymentId;
  reservationId: ReservationId;
  method: PaymentMethod;
  kind: PaymentKind;
  /** Amount captured, integer cents (DEC-112). */
  amountCents: number;
  /** Tax portion of `amountCents`, cents — recorded for the (parked) sales-tax report. */
  taxCents: number;
  /** ISO-4217 lowercase, e.g. "usd". */
  currency: string;
  /** Stripe Checkout session id (present when `method="stripe"`). */
  stripeCheckoutSessionId?: string;
  /** Stripe PaymentIntent id (present once the charge settles). */
  stripePaymentIntentId?: string;
  status: PaymentStatus;
  /** Cents refunded so far — set by hand-reconciliation if ever tracked; refunds are manual. */
  refundedCents?: number;
  /** ISO-8601 UTC. */
  createdAt: string;
}

/**
 * One vessel-day marked Muster-owned (DEC-106) — the coexistence partition unit.
 * When present, the importer skips + itemizes any Xola event landing on this
 * vessel+date (whole-vessel-day grain, NOT time); the day's events are Muster-native.
 * No FK, text date — house style (DEC-DATA-1). Keyed on (vesselId, date). Marked via
 * the `db:own` CLI; empty in production until an operator marks a day.
 */
export interface MusterOwnedVesselDay {
  vesselId: VesselId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** ISO-8601 UTC of the mark. */
  markedAt: string;
}

// ── Shift + Seat ────────────────────────────────────────────────────────────

export interface Shift {
  id: ShiftId;
  vesselId: VesselId;
  /** ISO-8601 date. Shifts group events by vessel + day. */
  date: string;
  /** Derived from seats (DEC-005); stored for query convenience. */
  state: ShiftState;
  eventIds: EventId[];
  /**
   * A manual split (DEC-083, #206): vessel-local "HH:MM" cut, on the **canonical**
   * (side-A) row only. Present → this vessel-day is split; `formShifts` derives
   * side A (`e.time < cut`) on this id and side B (`e.time >= cut`) on `{id}-b`
   * every pull, so the split survives Xola re-import. Absent → not split.
   */
  splitCutTime?: string;
}

export interface Seat {
  id: SeatId;
  shiftId: ShiftId;
  /** The role this seat demands — a `RoleTypeId` reference (DEC-ROLE-1), not an enum. */
  role: RoleTypeId;
  kind: SeatKind;
  state: SeatState;
  assignedCrewMemberId?: CrewMemberId;
  /**
   * `true` for an operator-added manning-override seat (8.5, SPEC §2.3) — a required
   * hand or a supernumerary/trainee beyond the derived COI minimum. `deriveSeats`
   * never produces one, so this flag protects a surplus REQUIRED override from
   * `formShifts`' manning-shrink prune (it survives re-import, like the split cut).
   * **Absent** for derived seats (null reads as not-override). Removed via `removeSeat`.
   */
  override?: boolean;
  /**
   * How the current occupant came to hold this seat (#196): `self_claim` (pulled
   * it on /crew/open) or `operator` (force-placed via the override). Drives the
   * My-shifts "Added for you" badge, which fires ONLY for `operator` — a self-claim
   * is an opt-in. **Absent** for an accepted-ask seat (the badge infers that opt-in
   * from the accepted ask itself), for Open/Bailed seats (cleared on re-open), and
   * for legacy pre-#196 rows (null reads as not-operator). An explicit `"ask"`
   * value isn't written — the accepted ask is the record; add it only if the
   * inference is ever retired.
   */
  acquiredVia?: "operator" | "self_claim";
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
 * The canonical messaging/notification identity (DEC-058). ONE type for everyone
 * the system can address — crew (a `CrewMemberId`) and the operator/office
 * (kind `"admin"`, participating as `OPERATOR_CREW_MEMBER_ID` in v1 — DEC-030 §7).
 * `id` is namespace-local, interpreted per `kind` (no FK — DEC-DATA-1). Auth's
 * `AuthSubject` is an alias of this; `Message.senderKind` and the `PresencePort`
 * (#112) key on this same `AuthSubjectKind` — never a parallel vocabulary, never
 * an `"operator"` synonym for `"admin"`. A future `"customer"` kind (portal
 * ~2027) widens `AuthSubjectKind` in one line — type- and schema-free; the
 * per-kind resolution surfaces it then touches are bounded, not free (DEC-058).
 */
export interface Subject {
  kind: AuthSubjectKind;
  id: string;
}

/**
 * A person with admin access (DEC-092, revises DEC-020's "admin is a free-form
 * non-identity"). Every admin is also crew, so `id` **is** the crew member's id
 * — an admin session is `{kind:"admin", id:<crewId>}`, that same person's crew
 * session is `{kind:"crew", id:<crewId>}`; `kind` disambiguates, no FK (DEC-DATA-1),
 * no crew-row validation (the service layer is the boundary). This table is the
 * *auth identity* only — deliberately NOT the DEC-058 messaging identity.
 *
 * `active` is the per-person revoke lever: `readSubject` fails an admin whose row
 * is missing or `active=false` on its next request — immediate, scoped to admins,
 * so the stateless crew hot path is untouched. `handle` is the short mint key
 * (`db:mint --admin=<handle>`). No `role` column — all admins are equal at launch
 * (roles deferred; the column is the clean seam). Dates are ISO-8601 UTC text.
 */
export interface Admin {
  /** = the crew id of the crew member who has admin access. */
  id: string;
  /** Short, unique mint key (e.g. `eric`). */
  handle: string;
  name: string;
  active: boolean;
  createdAt: string;
  /** ISO-8601 UTC; null while active. */
  deactivatedAt: string | null;
}

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

/**
 * A short numeric login code (DEC-081) — the crew self-serve sign-in primitive.
 *
 * A SIBLING to `MagicToken`, not a reuse: a 6-digit code is NOT globally unique
 * (two crew can mint the same digits), so it cannot ride `magic_tokens` (its
 * `token_hash` is `unique`) and cannot be looked up by hash. Instead it is keyed
 * by SUBJECT — exactly one live code per subject (re-request upserts) — which is
 * also what lets `attempts` cap brute-force guesses against the short secret.
 * Only `sha256(code)` is stored; the digits themselves never touch storage.
 */
export interface LoginCode {
  subjectKind: AuthSubjectKind;
  /** crewMemberId (crew) | operator handle (admin). The other half of the PK. */
  subjectId: string;
  /** sha256 of the raw code (hex). The code itself is never stored. */
  codeHash: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** ISO-8601 UTC. Past this instant the code is dead even if unconsumed. */
  expiresAt: string;
  /** Failed verify attempts — capped to defeat brute-force of the short secret. */
  attempts: number;
  /** ISO-8601 UTC; absent until redeemed. Single-use: set once, by the CAS. */
  consumedAt?: string;
}

/**
 * A crew member's persistent calendar-feed credential (#355, DEC-098) — the token
 * behind their subscribable iCal URL.
 *
 * Muster's FIRST persistent bearer credential (magic tokens / login codes are both
 * ephemeral). Like `MagicToken` it stores only `sha256(token)` and is looked up by
 * hash of the presented token — but unlike it, it never expires and there is exactly
 * ONE live feed per crew (`crewMemberId` is the PK). "Re-see the URL" is impossible
 * by design (hash-only); the recovery path is REGENERATE, which replaces this row and
 * kills the old hash — the same lever that revokes/rotates. It mints no session: a
 * read-only data capability, not a login (does not reopen DEC-081).
 */
export interface CalendarFeed {
  /** The crew member this feed belongs to — one live feed each (rotate = replace). */
  crewMemberId: CrewMemberId;
  /** sha256 of the raw token (hex). The token itself is never stored. */
  tokenHash: string;
  /** ISO-8601 UTC of the mint. */
  createdAt: string;
  /** ISO-8601 UTC of the last feed fetch — a best-effort "last synced" signal for
   *  the crew UI. Absent until the first poll. */
  lastPolledAt?: string;
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

/**
 * One queued doorbell-ring relay (DEC-073, the promotion gate). The
 * `OutboxNotificationChannel`'s `send` enqueues this instead of transmitting; the
 * operator works the same `/admin/outbox` page (a "New messages" section), texts the
 * deep link, marks it sent — the DEC-030 web-link model, mirroring {@link OutboxEntry}.
 *
 * Its OWN type + table (`ring_outbox`), NOT a union on `OutboxEntry` (DEC-073): a ring
 * has no ask/seat/claim — it carries a `threadId` and a deep-link to that thread. Same
 * adapter-side guardrail (nothing in the domain reads it) and freeze rule, but a fresh
 * one-time `link` is minted per ring-cycle, and the entry **drops from the worklist on
 * read** (`message_reads.last_read_at >= createdAt`) rather than settling on an answer —
 * so `createdAt` is the read-cancellation anchor.
 */
export interface RingOutboxEntry {
  /** Deterministic `ring-<threadId>-<crewMemberId>` — one slot per (thread, member). */
  id: RingOutboxEntryId;
  crewMemberId: CrewMemberId;
  /** The thread the ring covers — the deep-link target and the drop-on-read key. */
  threadId: ThreadId;
  /** The relay text ("N new" / inlined short note), frozen at enqueue. */
  body: string;
  /** The thread deep-link magic link (24h TTL), minted fresh per cycle + frozen. */
  link: string;
  status: OutboxStatus;
  /** ISO-8601 UTC — enqueue time / `deliveredAt`, and the drop-on-read anchor. */
  createdAt: string;
  /** ISO-8601 UTC; set when the operator marks it sent. Channel-side only. */
  sentAt?: string;
}

/** A crew member put ON or taken OFF a shift (DEC-084) — the two assignment-change
 * notices. `removed` is what merge (8.4) emits for a dropped side-B occupant. */
export type AssignmentAction = "added" | "removed" | "changed";

/**
 * One queued assignment-change relay (DEC-084, the THIRD operator-relay sibling to
 * {@link OutboxEntry} and {@link RingOutboxEntry}). `OutboxNoticeChannel.send`
 * enqueues this instead of transmitting; the operator works the `/admin/outbox`
 * "Assignment changes" section, texts the `/crew` link, marks it sent — the DEC-030
 * web-link model.
 *
 * Its OWN type + table (`notice_outbox`), NOT a union: a notice has no ask/seat/claim
 * (so not the ask outbox's NOT NULL correlation) and no thread/read-state (so not the
 * ring's drop-on-read). Same adapter-side guardrail (nothing in the domain reads it)
 * and freeze rule (`body` + `link` minted once at enqueue). **Terminal-on-sent**: a
 * sent notice STAYS as the durable "we told them" record — no drop-on-read, no
 * settle-on-answer. Deterministic id = one slot per (shift, member, action).
 */
export interface NoticeOutboxEntry {
  /** `notice-<shiftId>-<crewMemberId>-<action>` — one slot per (shift, member, action). */
  id: NoticeOutboxEntryId;
  crewMemberId: CrewMemberId;
  action: AssignmentAction;
  /** The relay text, frozen at enqueue. */
  body: string;
  /** The `/crew` magic link (24h TTL), minted + frozen at enqueue. */
  link: string;
  status: OutboxStatus;
  /** ISO-8601 UTC — enqueue time / `deliveredAt`. */
  createdAt: string;
  /** ISO-8601 UTC; set when the operator marks it sent. Channel-side only. */
  sentAt?: string;
}

/**
 * SMS-consent record (Twilio 10DLC opt-in — append-only audit). One row per opt-in
 * submission on the public crew login: WHO consented, at WHAT number, WHEN, and the
 * EXACT disclosure string + version they agreed to (so wording changes stay
 * auditable). Written best-effort from the login action; never read by the domain.
 */
export interface SmsConsent {
  id: SmsConsentId;
  /** The crew member the login email resolved to (recorded only on a roster match). */
  crewMemberId: CrewMemberId;
  /** The email entered at opt-in. */
  email: string;
  /** The roster phone at consent time (the number consented for); null if none on file. */
  phone: string | null;
  /** Disclosure version agreed to — bump when the copy changes. */
  disclosureVersion: string;
  /** The exact disclosure string shown, frozen. */
  disclosureText: string;
  /** ISO-8601 UTC. */
  consentedAt: string;
}

/**
 * A "we texted this guest" record (#345 Part B) — one per booking, upsert-latest:
 * who last texted them and when, so every crew member on the shift sees who's been
 * contacted. `contactedBy` is a subject id (crew or admin); `contactedByName` is a
 * display snapshot (no join on read, no-FK — DEC-DATA-1).
 */
export interface GuestContact {
  reservationId: ReservationId;
  shiftId: ShiftId;
  contactedBy: string;
  contactedByName: string;
  /** ISO-8601 UTC. */
  contactedAt: string;
}

export type { ReliabilityEvent } from "./reliability.js";
