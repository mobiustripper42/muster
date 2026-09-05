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
  AddOnId,
  CustomerId,
  AskId,
  BlockId,
  CheckoutHoldId,
  CredentialId,
  CrewMemberId,
  EventId,
  GratuityId,
  LocationId,
  MagicTokenId,
  OfferingId,
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
  TimePunchId,
  TimePunchEditId,
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
  /**
   * Vessel identity hue (DEC-086 palette, 12.9) — the index (1–6) of the locked
   * `--color-vessel-N` token this boat renders in across the crew shift board and the
   * reservation calendar. Operator-chosen on the Vessel admin (color is information, not
   * decoration — DEC-021/042). Optional: absent ⇒ the derived hue stands (pinned map, then a
   * stable id-hash), so an un-coloured vessel looks exactly as it did pre-12.9.
   */
  hue?: number;
  /**
   * Default launch Location (12.9) — the boat's home dock. Optional; a reference by id (no
   * FK, house style DEC-DATA-1). Display/config only; the availability deriver doesn't read it.
   */
  homeLocationId?: LocationId;
  /** Internal operator notes (12.9) — never customer-facing. */
  notes?: string;
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

/**
 * One time-clock interval (SPEC §2.9) — a **timesheet entry, not a tracker**.
 *
 * The one place in the crew model that stores **instants** rather than vessel-local
 * wall clock (DEC-032's deliberate exception, shared with the calendar feed): elapsed
 * time across a DST transition is only correct if both ends are absolute. Everything
 * user-facing about a punch is still *rendered* vessel-local, and period bucketing
 * runs off `vesselDateOf(inAt)`.
 */
export interface TimePunch {
  id: TimePunchId;
  crewMemberId: CrewMemberId;
  /** ISO-8601 UTC instant. When they went on the clock. */
  inAt: string;
  /** ISO-8601 UTC instant, or `null` — **still on the clock**, a state, not missing data. */
  outAt: string | null;
  /**
   * The shift this punch appears to belong to — **auto-matched at clock-in, never
   * asked for** (§2.9.2). Null on zero matches AND on several: an ambiguous tag is
   * worse than none, and hours are owed either way.
   */
  shiftId: ShiftId | null;
  /**
   * Who created it. An admin-entered punch must never be indistinguishable from one
   * somebody actually tapped (§2.9.8) — this is what makes the honor system survivable.
   */
  origin: TimePunchOrigin;
  /** Stamped when an admin changes a time; null otherwise. */
  adminEditedAt: string | null;
}

export type TimePunchOrigin = "crew" | "admin";

/**
 * One recorded change to a punch — append-only (#635, SPEC §2.9.8).
 *
 * **Why a trail and not columns.** `TimePunch.adminEditedAt` answers "did someone
 * else touch this?" for the LAST edit only. Once crew and admin can both edit the same
 * row, and every crew edit carries a **reason**, last-write-wins metadata loses the
 * story: a punch edited by its owner and then corrected by the office keeps only the
 * office's reason. The question that actually gets asked — "who changed my hours, and
 * why?" — is per-edit, so the record has to be per-edit.
 *
 * Same idiom as `reliability_events` (DEC-008) and the audit trail (DEC-118): append
 * only, never updated, never deleted. A punch's hours can be corrected; what was done
 * to it cannot be.
 */
export interface TimePunchEdit {
  id: TimePunchEditId;
  timePunchId: TimePunchId;
  /** Who made the change. `crew` = the punch's owner editing their own. */
  actorKind: TimePunchOrigin;
  /** The crew id for either kind — admins are crew (DEC-092/093). */
  actorId: CrewMemberId;
  /** ISO-8601 UTC. */
  at: string;
  action: TimePunchEditAction;
  /** The punch's times BEFORE this change — null on `created`. */
  fromInAt: string | null;
  fromOutAt: string | null;
  /** The punch's times AFTER it — null on `deleted`. */
  toInAt: string | null;
  toOutAt: string | null;
  /**
   * Why. **Required for a crew edit** and free text; the operator's own edits from the
   * repair bench may leave it empty, because an operator fixing a clock nobody tapped
   * is the surface's whole purpose rather than an exception to explain.
   */
  reason: string;
}

export type TimePunchEditAction = "created" | "changed" | "deleted";

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
  /**
   * Recurring weekday blackout (#411, DEC-119) — Mon=0…Sun=6 weekday indices this
   * crew member is permanently off, subtractive like PtoWindow (DEC-009). Read by
   * the `not_recurring_off` eligibility rule against the shift's vessel-local
   * weekday. Optional/absent ⇒ never off (treated as `[]`); the DB column defaults
   * to `[]`, so a persisted crew member always carries the field.
   */
  weekdaysOff?: number[];
  status: CrewStatus;
  /** Eric's manual thumb (§1.4): boost or floor. The score itself is not hand-edited. */
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
  /**
   * Gusto payroll identity (DEC-124, 12.3b) — the crew→Gusto map the gratuity report emits as
   * the timesheet CSV. Lives on the crew row (Muster owns crew natively; no separate map file,
   * unlike `xola-tip-extractor`'s `guide-gusto-map.json`). Optional: absent ⇒ the crew member's
   * tips warn loudly and their CSV row won't import (no `employeeId`). Seeded from the roster.
   */
  gusto?: GustoIdentity;
}

/** A crew member's Gusto timesheet identity (DEC-124, 12.3b) — the four fields the Gusto CSV
 *  keys on. `employeeId` is the import key; a row without it won't import. */
export interface GustoIdentity {
  firstName: string;
  lastName: string;
  title: string;
  employeeId: string;
}

// ── Event + Reservation ─────────────────────────────────────────────────────

// ── Reservation catalog — Offering / Location / Block (Phase 12, DEC-123/125) ─
//
// The virtual-availability read model (12.0). `Offering` + its `schedule` is the
// DEC-125 **rule**; open departures are COMPUTED (`deriveVirtualAvailability`), not
// materialized — an `Event` row exists only once a slot acquires state (booked /
// override). These interfaces carry exactly the fields the deriver reads, plus the
// price-composition inputs, so the shape is coherent end-to-end. Later tasks APPEND
// inert display/config fields (12.8 catalog: photos, add-ons, gratuity config; 12.9
// location admin) and the WRITE ports + admin UI — they never redefine these.

/**
 * A pickup place — first-class so a **location block** (DEC-125) can dark every
 * offering leaving from it at once, and so the confirmation/manage surfaces can show
 * pickup + route copy. The deriver reads NO `Location` field; it only matches an
 * `Offering.locationId` against a location-kind `Block`. Rows exist for coexistence
 * coherence + the 12.9 admin surface.
 */
export interface Location {
  id: LocationId;
  name: string;
  /** Where to meet — the customer-facing pickup description. */
  pickupDescription: string;
  /** Optional tappable map link for the pickup point. */
  pickupLink?: string;
  /** What the trip does — route/experience blurb. */
  routeDescription: string;
}

/**
 * Publish state (DEC-123 catalog model). Only `live` offerings publish their rule and
 * therefore generate virtual slots — a `draft` or `hidden` offering emits nothing.
 */
export type OfferingStatus = "draft" | "live" | "hidden";

/**
 * One rule in an offering's ordered price list (DEC-123/125). Evaluated **first match
 * wins — never stacked** (operator, settled in the catalog mockup): the deriver walks
 * `priceVariations` in order and stops at the first `applies` that matches the date.
 */
export interface PriceVariation {
  /** Operator label, e.g. "July 4th", "Prime Saturday". Display only. */
  label: string;
  /** When this variation applies. Weekdays are Mon=0…Sun=6 (vessel-local). */
  applies:
    | { kind: "weekdays"; weekdays: number[] }
    | { kind: "date"; date: string }
    | { kind: "dateRange"; start: string; end: string };
  /** How it moves the base fare. `flatCents` adds/subtracts cents; `percent` is ±%. */
  adjustment:
    | { kind: "flatCents"; deltaCents: number }
    | { kind: "percent"; percent: number };
}

/**
 * The DEC-125 schedule **rule** — a season window + weekday mask + departure clock
 * times. `deriveVirtualAvailability` expands this across vessels × dates into virtual
 * slots; no row is written. Editing it just recomputes (nothing to rewrite).
 */
export interface OfferingSchedule {
  /** ISO-8601 inclusive season start (vessel-local day). */
  seasonStart: string;
  /** ISO-8601 inclusive season end. */
  seasonEnd: string;
  /** Weekdays the trip runs — Mon=0…Sun=6. */
  weekdays: number[];
  /** Departure clock times, e.g. ["11:30","13:30","15:30"]. */
  departureTimes: string[];
}

/**
 * A sellable experience (= Xola Experience). The `schedule` + `basePriceCents` +
 * `priceVariations` are the DEC-125 rule the deriver expands. Capacity is NOT here —
 * it's the running vessel's `coiMaxPax` (whole-boat, DEC-108/109). `extraGuestPriceCents`
 * is read at BOOKING time (base + extras × extraGuestPrice + gratuity, DEC-124), never
 * by the availability deriver.
 */
export interface Offering {
  id: OfferingId;
  tenantId: TenantId;
  name: string;
  status: OfferingStatus;
  /** Customer-facing description (12.8 catalog) — markdown, rendered on browse/checkout. */
  description?: string;
  /** Minutes on the water (12.8) — display config; the customer sees "1h 40min". */
  tripLengthMinutes?: number;
  /** Minutes the boat is held per departure, turnaround included (12.8). Display/config. */
  holdMinutes?: number;
  /** Minutes before departure the guests are told to arrive (12.8). Display/config. */
  arriveBeforeMinutes?: number;
  /** The boats this offering can run on; each expands into its own per-vessel slot. */
  vesselIds: VesselId[];
  /** Pickup place — the location-block target. */
  locationId: LocationId;
  schedule: OfferingSchedule;
  /** Whole-boat base fare in integer CENTS (DEC-112), before variations. */
  basePriceCents: number;
  /** Ordered price rules; first match wins (see {@link PriceVariation}). */
  priceVariations: PriceVariation[];
  /**
   * Base-fare included guest count (DEC-125 build note pricing composition; moved
   * Vessel → Offering in 12.8 — the included count prices the PRODUCT, not the boat) — the
   * whole-boat base fare covers up to this many guests; each guest ABOVE it adds
   * `extraGuestPriceCents`, up to the running vessel's `coiMaxPax` (the cap stays a Vessel
   * fact). Optional/nullable: absent ⇒ treated as `coiMaxPax` (whole boat included, no
   * per-guest extras). Booking-time only; the availability deriver never reads it (DEC-125).
   */
  includedGuestCount?: number;
  /** Per-guest surcharge over the base-fare included count — booking-time only (DEC-124). */
  extraGuestPriceCents: number;
  /**
   * Per-kind gratuity config (12.8, DEC-124) — one entry per collected kind (`pre` at
   * checkout, typically required; `post` via the booking link, not required). Replaces the
   * flat `gratuityTiersBps`/`gratuityDefaultBps` pair (migrated into a `pre` entry).
   * Optional/absent ⇒ the code defaults (`GRATUITY_KINDS_DEFAULT`: pre required + post
   * optional, tiers 15/20/25%). Gratuity is first-class crew money — tax/fee-EXEMPT, keyed
   * by kind, deliberately NOT an add-on.
   */
  gratuityKinds?: GratuityKindConfig[];
  /**
   * Attached add-ons (#491) — references to first-class {@link AddOn} entities the offering
   * sells, picked by id from the shared catalog (`/admin/add-ons`), NOT defined inline. Mirrors
   * `vesselIds`. `required` is a GLOBAL property of the AddOn, not of this attachment. Taxed +
   * fee'd as REVENUE, unlike gratuity. Optional/absent ⇒ none.
   */
  addOnIds?: AddOnId[];
}

/**
 * One gratuity kind's collection config (12.8, DEC-124). `tiersBps` are the offered tip
 * choices in basis points; `defaultBps` is the pre-selected one (∈ `tiersBps`); `required`
 * means the customer must pick a tier (pre's posture — no decline), vs. optional (post).
 */
export interface GratuityKindConfig {
  kind: GratuityKind;
  tiersBps: number[];
  defaultBps: number;
  required: boolean;
}

/**
 * A customer CONTACT RECORD (12.12b, DEC-132) — not an account. No password, no login; the
 * customer never authenticates. It exists so two bookings by the same person hang together.
 *
 * **Identity is the phone, but the PK is not.** `phoneE164` carries a UNIQUE constraint (same
 * phone ⇒ same customer, so "merge duplicate contacts" mostly dissolves), while `id` is an
 * immutable surrogate. Welding a mutable business fact into the key means migrating the row and
 * every reference when a number changes, and a carrier-recycled number would inherit the previous
 * customer's history — the same instinct as the `Reservation.eventId` guardrail.
 *
 * Phone is REQUIRED as of 12.12b; whether identity should ultimately be phone-OR-email is
 * deliberately deferred (DEC-132) and will be forced by the Xola importer at cutover. All
 * resolution lives in `src/customers/identity.ts` so that stays a one-file policy change.
 */
export interface Customer {
  id: CustomerId;
  /** Readable short code, `C-` + 6 Crockford base32 chars — UNIQUE. Operator convenience
   *  (something short to say on the phone), NOT a customer-facing account number. */
  displayCode: string;
  name: string;
  /** Canonical E.164 — the identity key, UNIQUE. Produced ONLY by `canonicalizePhone`. */
  phoneE164: string;
  email?: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  notes?: string;
  /** Soft-retire (DEC-123 posture). Note soft-delete RETAINS PII — true erasure is out of scope. */
  active: boolean;
}

/**
 * A customer's booking code (#741, DEC-154) — the credential behind `/b/<code>`, and the row
 * that gives the manage link the three things DEC-122's stateless HMAC could never have:
 * revocation (`revokedAt`), expiry (`expiresAt`), and reissue (a second row for the same
 * reservation).
 *
 * MANY-to-one by construction: a reissue mints a new row and revokes the prior ones rather than
 * mutating a code in place, so a support conversation can still tell "this link was replaced"
 * from "this link never existed".
 */
export interface BookingCode {
  /** 14 Crockford base32 chars — the PRIMARY KEY. Minted by `mintBookingCode`. */
  code: string;
  reservationId: ReservationId;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** ISO-8601 UTC. Set ⇒ the code stops working at that instant. Unset today (see
   *  `bookingCodeRefusal`) — a manage page stays open for the post-trip tip and the receipt. */
  expiresAt?: string;
  /** ISO-8601 UTC. Set ⇒ killed, by a reissue or an operator revoke. Never un-set. */
  revokedAt?: string;
}

/**
 * A first-class sellable add-on (#491) — revenue, taxed + fee'd (the opposite of gratuity).
 * Its own entity (like {@link Vessel}/{@link Location}), edited once at `/admin/add-ons` and
 * ATTACHED to offerings by id (`Offering.addOnIds`). `type` is `"flat"` only for now; a text
 * discriminator so new pricing shapes are a value, not a migration (DEC-DATA-1 posture).
 */
export interface AddOn {
  id: AddOnId;
  tenantId: TenantId;
  label: string;
  type: "flat";
  amountCents: number;
  /** GLOBAL — a property of the add-on itself, not of any offering attachment (#491). */
  required: boolean;
  /** Soft-retire (DEC-123 posture): `false` ⇒ out of the offering picker + browse, refs kept. */
  active: boolean;
}

// ── Gratuity — first-class crew money (DEC-124, 12.3) ─────────────────────────

/** Which leg collected the gratuity: `pre` = required at checkout; `post` = added later via
 *  the booking-link manage page. Text, not an enum — the column takes more kinds if they
 *  appear (DEC-DATA-1). */
export type GratuityKind = "pre" | "post";

/**
 * One collected gratuity (DEC-124). **Crew money, NOT revenue** — tax- and service-fee-exempt,
 * charged in full (never deposit-split), and it routes to crew via the per-event pool that the
 * 12.3b payroll report splits across the event's assigned crew. Linked to BOTH the `event`
 * (the split grain) and the `reservation` (post-trip attach + cancel exclusion). The `id` is
 * deterministic from the Stripe session (`grat_${kind}_${sessionId}`) so a re-delivered webhook
 * upserts, never double-counts.
 */
export interface Gratuity {
  id: GratuityId;
  eventId: EventId;
  reservationId: ReservationId;
  kind: GratuityKind;
  /** Integer CENTS (DEC-112). Never taxed, never fee'd (DEC-124). */
  amountCents: number;
  /** Tier chosen, basis points — pre only (post is a free amount); provenance for the summary. */
  bps?: number;
  /** The Stripe session that collected it — reconciliation handle. */
  stripeCheckoutSessionId?: string;
  /** ISO-8601 UTC. */
  createdAt: string;
}

/**
 * An availability **subtraction** (DEC-125) — blackout as scoped blocks, not Xola's
 * per-event toggle. Three kinds, discriminated on `kind`:
 *  - `location`   — a date + time WINDOW; the river's closed → every slot at that
 *                   `Location` (across offerings/vessels) in the window goes dark.
 *  - `vessel`     — a date RANGE; a boat's out of service → all its slots gone.
 *  - `vesselHold` — a SINGLE slot reserved for a private thing, with no customer
 *                   `Event`. NB: distinct from the DEC-109 transient checkout-hold
 *                   (a claim-path row — 12.1's concern, not modeled here).
 * No FK / no CHECK on `kind` — house style (DEC-DATA-1).
 */
export type Block =
  | {
      id: BlockId;
      kind: "location";
      locationId: LocationId;
      /** ISO-8601 day. */
      date: string;
      /** Inclusive "HH:MM" window the closure covers. */
      startTime: string;
      endTime: string;
      note?: string;
    }
  | {
      id: BlockId;
      kind: "vessel";
      vesselId: VesselId;
      /** Inclusive ISO-8601 out-of-service range. */
      startDate: string;
      endDate: string;
      note?: string;
    }
  | {
      id: BlockId;
      kind: "vesselHold";
      vesselId: VesselId;
      /** ISO-8601 day. */
      date: string;
      /** The single departure "HH:MM" held. */
      time: string;
      note?: string;
    };

export type EventStatus = "scheduled" | "cancelled";

/**
 * Coexistence discriminator (DEC-106): which system OWNS this event/reservation.
 * `'xola'` = imported from Xola (the importer structurally only ever writes this);
 * `'muster'` = a Muster-native reservation (the booking path sets it explicitly).
 * Plain text union, never a DB enum/CHECK — validation is the service layer's
 * (DEC-DATA-1), so the in-memory + Postgres adapters stay behaviorally identical.
 * A future source widens this in one line. Log day one (DEC-008): real from the
 * first commit even though the availability deriver (11.1) is the first reader.
 * `'admin'` = an operator-entered reservation (DEC-163, amending §2.8.7/§2.8.8/§2.10.6):
 * no payment window, never reaped, and the reader has to be able to tell. Registered in
 * 14.2 so the reaper can branch on it; the surface that writes one is Phase 16.
 */
export type Source = "xola" | "muster" | "admin";

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
  /**
   * Minutes on the water for THIS departure (#570) — the per-event trip length
   * DEC-041 named as its eventual (b) source. Seeded from the running
   * `Offering.tripLengthMinutes` and **frozen here at materialization**, never
   * resolved from the offering on read: the same posture as `price` (DEC-125) and
   * the reservation's `extrasCents` (#474), because a later edit to the offering
   * must not retroactively change how long a trip that already ran was. It is also
   * what makes a post-booking extra-time upsell expressible — that writes this
   * field, and `shiftEndFromEvents` (and so the completion sweep, and so crew
   * reliability) follows the money.
   *
   * Absent ⇒ the flat `TRIP_DURATION_MINUTES` fallback.
   *
   * **Xola-sourced events carry it when their boat declares one.** Xola's API still
   * exposes no product length and nothing reads one; the value comes from
   * `FleetVessel.tripLengthMinutes` in the resource map — DEC-041's "(b)
   * operator-configured per-vessel length", landing as seed data. A boat that
   * declares nothing still leaves this absent, which is most of the fleet.
   */
  durationMinutes?: number;
}

/**
 * SPEC §2.8.1 — three states, no fourth. A `pending` row is the checkout in flight; it
 * becomes `booked` when payment confirms. "Lapsed" is a pending row past its payment
 * window, computed from the clock on every read and never stored, so it is not here.
 * Every reader is an allow-list (`status === "booked"`), never `!== "cancelled"` — a
 * deny-list silently admits `pending`.
 */
export type ReservationStatus = "pending" | "booked" | "cancelled";

/**
 * The one allow-list (§2.8.1, 14.3). Paid and live — the row the manifest, the money paths,
 * the calendar and every admin list mean when they say "a reservation".
 *
 * This answers exactly one question and must never grow a second: no `isLive`, no "booked or
 * a pending row still inside its window" hiding behind it — a helper that answers two
 * questions is a deny-list with a friendlier name. "Does this pending row still hold its
 * boat" is 14.8's, under its own name, doing the clock arithmetic §2.8.1 requires.
 *
 * A reader that wants `cancelled` too (the receipt is still readable behind a manage link)
 * names both statuses itself, so the grep for readers that bypass this stays honest.
 */
export function isBooked(r: Pick<Reservation, "status">): boolean {
  return r.status === "booked";
}

/**
 * SPEC §2.8.2 — a pending reservation names a slot, not an Event, and its `eventId` is
 * null until it confirms. The Event is materialized at confirm time, so before that there
 * is nothing to point at; pre-computing the id would put in-flight checkouts on the crew
 * manifest. Readers that need the Event of a row that must already be booked go through
 * `eventIdOfBooked` — after `isBooked`, so a pending row is refused as an outcome rather
 * than thrown as a defect. The throw is for a `booked` row with no event, which is a write
 * bug, not a state.
 */
export function eventIdOfBooked(r: Pick<Reservation, "id" | "eventId" | "status">): EventId {
  if (r.eventId === null) {
    throw new Error(`reservation ${r.id} is ${r.status} and has no event (SPEC §2.8.2)`);
  }
  return r.eventId;
}

export interface Reservation {
  id: ReservationId;
  /** Null while `pending` (§2.8.2); set on every row that has been `booked`. */
  eventId: EventId | null;
  /** Coexistence owner (DEC-106). Log day one; `'xola'` for every imported reservation. */
  source: Source;
  customerName: string;
  partySize: number;
  /**
   * The extra-guest surcharge portion of the booked fare, in integer CENTS, FROZEN at
   * booking (12.2, DEC-107 amend / #474). `Event.price` is the per-departure BASE only
   * (DEC-125); the fare the customer was charged is `base + extrasCents` (`composeFare`,
   * `extraGuests × extraGuestPriceCents`). The balance deriver reads this so a deposit-mode
   * balance collects the extras too — it is deliberately a booking property (a function of
   * `guestCount`), NOT on `Event`, and NOT recomputed from the live Offering (that would
   * reintroduce config drift `balanceOwedCents` forbids). Absent ⇒ 0: `'xola'` reservations,
   * the legacy seeded booking path (base carried the whole price; retired #693), and any
   * pre-12.2 row.
   */
  extrasCents?: number;
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
  /**
   * The {@link Customer} this booking belongs to (12.12b, DEC-132) — the FIRST real foreign key
   * in this schema, per DEC-131 (the DB may hold structural invariants; it still holds no
   * business rules). Nullable on purpose: historical reservations that never captured a
   * canonicalizable phone stay unlinked permanently, and `NULL` passes the FK.
   *
   * Set by `writeSlotBooking`'s get-or-create at booking time and by the one-time backfill (and
   * by the importer since #701). NOT set
   * by the Xola importer — importer-created customers are deferred to the cutover (DEC-132).
   */
  customerId?: CustomerId;
  /**
   * Who ended this booking (#724) — `'customer'` (they asked) or `'operator'` (we cancelled:
   * weather, crew, mechanical). Absent on a live booking, and on any cancellation made before
   * this was recorded.
   *
   * **Log day one, in the DEC-008 sense, because it cannot be reconstructed.** The cancel confirm
   * has always asked this question — it is the discriminator the refund branches on
   * (`refund-terms.ts`: a customer cancellation inside the window keeps a $50 fee, ours refunds
   * in full). Until #724 the answer picked a policy and was discarded, leaving the refund AMOUNT
   * as the only evidence of which branch ran, and the operator can type over the amount. So
   * "why did we lose this trip", and the question with money attached — "how many did we cancel
   * for weather last season" — had no answer in the database and never would for any booking
   * already cancelled.
   *
   * Set once, by `cancelReservation`. The repair path re-runs against an already-cancelled
   * reservation and deliberately does NOT overwrite it: the first answer is the real one.
   */
  cancelledBy?: CancelledBy;
  // No waiver field — DEC-012.

  // ── The slot a `pending` row names (14.4, SPEC §2.8.2–2.8.4) ──────────────────────────────
  // Written before Stripe is called. All optional because every row written before 14.4 — and
  // every `'xola'` row — has none of them; a pending row has all of `vesselId`, `date`, `time`,
  // `offeringId`, `reservedAt`, `holdMinutes`, `tripMinutes`.
  /** The hull the row occupies. `Event.vesselId` once confirmed; here until then. */
  vesselId?: VesselId;
  /** `YYYY-MM-DD`, the reserved departure day. */
  date?: string;
  /** `HH:MM`, the reserved departure time — a listed departure on the offering's grid. */
  time?: string;
  offeringId?: OfferingId;
  /**
   * ISO-8601 UTC instant the row was written. Lapse is COMPUTED from this plus the payment
   * window (`PAYMENT_WINDOW_MINUTES`, `src/reservations/pending.ts`) at read time (§2.8.1); no
   * `lapsed` state is ever stored. Absent on admin-source rows — they never lapse (DEC-163).
   */
  reservedAt?: string;
  /**
   * The checkout session's cookie token. A retry from the same session must not be refused by
   * its own earlier row (14.6 collapses the retry onto one row). Never sent to Stripe.
   */
  holderToken?: string;
  /**
   * The Stripe PaymentIntent id, recorded once Stripe answers. Confirm finds the row by it
   * (issue #916). Absent when Stripe threw — the row is still real and still occupies.
   */
  paymentIntentId?: string;
  /**
   * How long the hull is committed for this departure, FROZEN from `Offering.holdMinutes` at
   * write time (DEC-161). This is what the row occupies the hull for (§2.8.3). Not the payment
   * window — that is a setting, and the same word in `checkout_holds` land.
   */
  holdMinutes?: number;
  /** Frozen `Offering.tripLengthMinutes`. What the Event runs for once confirmed (DEC-161). */
  tripMinutes?: number;
  /** Every money component in cents and its rate, frozen at write time (DEC-164). */
  invoice?: BookingInvoice;
}

/**
 * The frozen quote (DEC-164): one JSON, every component in cents AND the rate it was computed
 * at, so the number on the row can be audited without the setting that produced it. Money only —
 * durations are columns on the reservation, and anything with a time is a column.
 */
export interface BookingInvoice {
  /** Base fare for the departure — `Event.price`/offering price at write time, before extras. */
  fareCents: number;
  /** Extra-guest surcharge, `extraGuests × extraGuestPriceCents`. */
  extrasCents: number;
  /** On fare + extras. */
  taxCents: number;
  taxRateBps: number;
  /** On fare + extras. */
  serviceFeeCents: number;
  serviceFeeBps: number;
  /** The mandatory tier (DEC-124), on fare + extras. */
  gratuityCents: number;
  gratuityBps: number;
  /** Sum of the five cents fields — the trip's price, not necessarily what was charged now. */
  totalCents: number;
}

/** Who ended a booking (#724). The refund policy branches on it — see `refund-terms.ts`. */
export type CancelledBy = "customer" | "operator";

// ── CheckoutHold — the transient 15-min soft reservation (12.1, DEC-109) ──────

/**
 * A customer checkout-hold (DEC-109): the **optimistic** front-door that makes the
 * common case collision-free — while a buyer is paying, the slot reads unavailable, so
 * the second buyer never starts. **Distinct** from the DEC-125 admin/vessel-hold
 * *block* (a `Block{kind:"vesselHold"}` row, no lifetime) — this one is transient,
 * lazily-expired, and tied to a Stripe session.
 *
 * Load-bearing rules (DEC-109), enforced by 12.1's data layer:
 *  - The hold is an **optimization**, never the authority — the whole-boat mutex
 *    (`saveBookingIfSlotFree`) is the backstop; a booking whose hold expired mid-payment
 *    still runs the CAS. Never gate the write on a hold. The backstop guards the whole
 *    HULL over the trip's duration, not just the exact `(vessel, date, time)` triple —
 *    identity alone let two overlapping bookings through in silence (#691).
 *  - **Lazy-on-read expiry, no cron:** a hold with `expiresAt <= asOf` reads as free
 *    everywhere (the deriver filters on it). The physical-slot unique index means a
 *    stale row would *block* re-acquire, so `acquireCheckoutHold` deletes the expired
 *    row for the identity first, in the same critical section.
 *  - **Holds are only ever read through the `expiresAt > asOf` filter** — never
 *    raw-counted. A raw `SELECT … WHERE slot=…` that treats a hit as "held" would
 *    resurrect an expired hold; the deriver + `acquireCheckoutHold` are the only
 *    sanctioned readers.
 */
export interface CheckoutHold {
  id: CheckoutHoldId;
  /** The boat this hold is on — assignment is resolved at acquire (fit-and-fallback). */
  vesselId: VesselId;
  /** ISO-8601 vessel-local day. */
  date: string;
  /** Departure clock "HH:MM". */
  time: string;
  /** Constant `'muster'` — keeps the slot-identity key parallel to `Event`'s (DEC-125). */
  source: "muster";
  offeringId: OfferingId;
  /** Guest/passenger count (never "party") — validated ≤ boat COI cap at acquire. */
  guestCount: number;
  /** ISO-8601 UTC — acquire instant + 15 min. Lazily compared to `asOf`; no cron. */
  expiresAt: string;
  /** ISO-8601 UTC of acquire. */
  createdAt: string;
  /** Bound once the Checkout session is created — links the hold to its payment. */
  stripeCheckoutSessionId?: string;
  /**
   * Which checkout SESSION owns this hold (#575) — an opaque token from `mintHolderToken`,
   * carried in an httpOnly cookie.
   *
   * Exists so a buyer retrying a declined card reuses this hold instead of taking a second boat.
   * Deliberately a possession token and NOT the buyer's email or phone: those are typed into a
   * public form, so keying on them made "knowing a stranger's address" sufficient to take over
   * or delete their hold (`holder-token.ts` records the review that caught it).
   *
   * Absent ⇒ never reused, and never matches another tokenless hold — two anonymous sessions
   * sharing one is the only way this rule could sell a boat twice.
   */
  holderToken?: string;
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

/** Operator-initiated refunds are manual in the Stripe dashboard. The ONE programmatic
 *  refund Muster issues is the DEC-109 residual-race auto-refund (12.1b) — a buyer whose
 *  hold expired mid-payment and who lost the slot is refunded without anyone deciding, and
 *  the webhook writes the outcome back via `markPaymentRefunded`.
 *
 *  **`disputed` / `dispute_lost` (issue #723).** A chargeback is money leaving the account
 *  without a refund: the cardholder went to their bank, not to us. `disputed` is the live
 *  state (funds pulled, outcome pending); `dispute_lost` is the terminal one. A dispute we
 *  WIN goes back to `succeeded` — the money returned, and the argument itself lives in the
 *  Stripe dashboard, which is the system of record for the evidence and the deadlines.
 *
 *  **Neither counts as paid** — see `countsAsPaid`, which is an ALLOW-list precisely so a
 *  new state added here defaults to not-money rather than to money. */
export type PaymentStatus =
  | "succeeded"
  | "refunded"
  | "partially_refunded"
  | "disputed"
  | "dispute_lost";

/**
 * One money movement against a Muster-native reservation (DEC-107). A booking is a
 * 1:n money log — `full`, or `deposit` then `balance` — modeled as a separate append
 * record like every other Muster side-effect log (reliability, outbox, audit), NOT as
 * columns on `Reservation` (which is shared with Xola, whose money lives in Xola —
 * DEC-105/106; payment columns would sit null on every imported row). No FK
 * (DEC-DATA-1). Balance-due is DERIVED (`price + tax − Σ succeeded`), never stored.
 */
export interface Payment {
  /** Deterministic from the Stripe checkout-session id (hosted) or PaymentIntent id
   *  (Elements, DEC-134) — idempotent write either way. */
  id: PaymentId;
  reservationId: ReservationId;
  method: PaymentMethod;
  kind: PaymentKind;
  /** Amount captured, integer cents (DEC-112). */
  amountCents: number;
  /** Tax portion of `amountCents`, cents — recorded for the (parked) sales-tax report. */
  taxCents: number;
  /**
   * Gratuity portion of `amountCents`, cents (DEC-124, 12.3) — crew money, NOT price+tax. The
   * booking charge bundles the tip into `amountCents`, so `balanceOwedCents` MUST net this out
   * or a deposit booking's balance under-charges. Optional/absent ⇒ 0 (no gratuity, or a
   * balance/pre-12.3 payment).
   */
  gratuityCents?: number;
  /**
   * Service-fee portion of `amountCents`, cents (DEC-134, 12.5) — a one-shot surcharge on the
   * fare, frozen at checkout and charged in full with the deposit. `balanceOwedCents` MUST net
   * this out like the gratuity, or a deposit booking's balance under-charges. Optional/absent
   * ⇒ 0 (a balance payment, or a pre-12.5 hosted booking).
   */
  serviceFeeCents?: number;
  /** ISO-4217 lowercase, e.g. "usd". */
  currency: string;
  /** Stripe Checkout session id (hosted-Checkout payments; absent on an Elements
   *  PaymentIntent payment, which carries only `stripePaymentIntentId` — DEC-134). */
  stripeCheckoutSessionId?: string;
  /** Stripe PaymentIntent id (present once the charge settles). */
  stripePaymentIntentId?: string;
  /**
   * Stripe's HOSTED RECEIPT url (#679) — `pay.stripe.com/receipts/…`, a guest-safe page shown on
   * `/b/<code>`. Not a dashboard link; a customer must never be handed one of those.
   *
   * Captured at webhook time rather than fetched when the manage page renders, because that page
   * is a guest-facing GET and a live Stripe call in it would break the booking view whenever
   * Stripe is slow. Absent on every payment written before #679, on one whose receipt lookup
   * failed, and on any payment Stripe has no receipt for — absent is not an error.
   */
  receiptUrl?: string;
  status: PaymentStatus;
  /** Cents refunded so far. Written by `markPaymentRefunded` on the residual-race auto-refund;
   *  an operator's manual dashboard refund is not reflected here until hand-reconciled. */
  refundedCents?: number;
  /** ISO-8601 UTC. */
  createdAt: string;
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
  /**
   * The earliest scheduled departure as an ISO instant, **absent when unknown**.
   * A change-detection watermark, not a display source (#740).
   *
   * Deliberately `string | undefined`, NOT `string | null` (@code-review). There is
   * exactly one meaning — "we don't know what this was" — and one representation.
   * A nullable version invited a second, `null` for "known, nothing scheduled", which
   * the postgres adapter's `opt()` cannot represent anyway: it maps SQL NULL to an
   * absent key, so the two would silently collapse on one adapter and not the other.
   * A shift with nothing scheduled never reaches this field regardless — it returns
   * down the all-cancelled path before the watermark is written.
   *
   * Times are derived, never stored (DEC-022), and everything that RENDERS a departure
   * or call time still derives it from the events. This exists for one job the events
   * cannot do: `formShifts` compares the freshly derived day against the STORED shift,
   * and the stored shift carried only `eventIds` — so a trip retimed in place kept the
   * same id set, the diff gate saw nothing, and the crew were never told their call
   * time had moved. A watermark is the only way to notice a change in a value that is
   * otherwise recomputed from scratch each run.
   *
   * Written on every form. Absent on rows written before the column existed, which
   * reads as "unknown" and is deliberately NOT treated as a change (see `form-shifts`).
   */
  earliestStart?: string;
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

/**
 * How an ask ended. `accepted`/`declined` are the crew member's own answers.
 *
 * **`withdrawn` (#600) is not an answer — it's the ask being retired unanswered
 * because the seat stopped being fillable.** When a claim wins, every other
 * outstanding ask on that seat is moot: the question "will you work this?" no longer
 * has a meaning. Before #600 those rows were simply left live, and `expireAsks`
 * would later stamp them `ask_ignored` — charging silence to people who were never
 * given a chance to answer, on a seat taken 51 seconds after they were asked.
 *
 * Distinct from the timeout marker (`respondedAt` set, `response` **absent**), which
 * means "we waited and they said nothing" and DOES carry an `ask_ignored`. A
 * `withdrawn` ask carries **no reliability event at all** — nothing happened worth
 * scoring.
 *
 * No migration: `asks.response` is plain `text` with no CHECK constraint.
 */
export type AskResponse = "accepted" | "declined" | "withdrawn";

/**
 * What a HUMAN can answer — the submittable subset of {@link AskResponse} (#600).
 *
 * `withdrawn` is a system outcome, never an answer, so it must not be reachable from
 * any surface that takes crew (or operator-as-crew) input. Naming the subset makes
 * that a type error rather than a validation rule someone has to remember: every
 * answer door (`recordResponse`, `recordResponseAndConfirm`, `recordResponseAs`, the
 * crewapp's answered-code) takes this, and only the engine's own
 * `withdrawLiveAsks` writes the wider value.
 */
export type AskAnswer = Exclude<AskResponse, "withdrawn">;

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
 * (Eric) link carries an operator identifier (email/handle) — there is no admin
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
  /** Failed verify attempts against THIS code — reset to 0 by every re-mint. */
  attempts: number;
  /**
   * Start of the rolling failure window (ISO-8601 UTC), or absent before the first
   * failure. Survives the re-mint that resets `attempts`, which is the whole point:
   * `attempts` bounds guesses per code, this pair bounds them per person (DEC-142,
   * #522). Absent on rows written before the window existed — they open one on their
   * next failure rather than inheriting a window they never had.
   */
  failedSince?: string;
  /** Failed verifies accumulated across every code minted inside the current window. */
  failedInWindow?: number;
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
  /** The magic link (24h TTL) to the Yes/No screen, minted + frozen at enqueue. */
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
