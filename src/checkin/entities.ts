/**
 * Check-in & waivers — the stored shapes (Phase 18.1, issue #1115).
 *
 * The module's spec is `docs/design/check-in-and-waivers.md` (§6 is the data model, DEC-187 scopes
 * it in). Three facts live here and they stay independent: a guest **signed**, a guest was
 * **checked in** by crew, and the departure was **counted**. None is derived from another.
 *
 * Business rules — an adult signer gives an email, one signing covers at most one adult and ten
 * kids, `isMinor` is worked out from the date of birth and then frozen, and nothing exceeds the
 * boat's COI limit — belong to the domain functions that build these rows, never to the tables
 * (DEC-131: the database holds structural facts only).
 */
import type { CrewMemberId, EventId, GuestId, ReservationId, WaiverTemplateId } from "../domain/ids.js";

/**
 * One version of the waiver text. **Insert-only**: new text is a new row, and no row is ever
 * edited, so the exact words a guest agreed to can always be produced.
 *
 * Which version is current is worked out, never stored: the one with the latest `effectiveFrom`
 * that is not in the future. That is why there is no `retiredAt` — retiring a version would be an
 * edit to it.
 */
export interface WaiverTemplate {
  id: WaiverTemplateId;
  /** The label people see, e.g. `brewboat-2026-v1`. */
  version: string;
  /** The exact text a guest is shown and agrees to. Markdown is fine; how it renders is 18.4's. */
  body: string;
  /** ISO-8601 UTC. May be in the future: a version posted today can take effect next week. */
  effectiveFrom: string;
  /** ISO-8601 UTC — when it was posted, which is not when it takes effect. */
  postedAt: string;
  /** The admin who posted it (an `admins` id, which is a crew id — DEC-092). */
  postedBy: string;
}

/** Who a guarded minor's signer is to them. */
export type GuardianRelation = "parent" | "guardian" | "custodian";

/** How a guest row came to exist. */
export type GuestSource = "booker" | "self" | "crew";

/**
 * One signing, or — in roster mode — one person the booking names before they sign.
 *
 * **Every signing is its own row, and nothing is ever merged or replaced.** Phone and email are
 * not identity: couples share an email and a family passes one phone down the line at the dock.
 * Replacing on a matching contact would silently delete a real person's signature.
 */
export interface Guest {
  id: GuestId;
  eventId: EventId;
  /** Absent for a walk-up. */
  reservationId?: ReservationId;
  name: string;
  /** Lowercased. Required on an adult's row — enforced where rows are built, not here. */
  email?: string;
  /** E.164. Optional. */
  phone?: string;
  /** ISO-8601 date. Cleared by retention; `isMinor` survives it. */
  dob?: string;
  /** Derived from `dob` at signing, then never recomputed. */
  isMinor: boolean;
  /** A minor's row points at the adult who signed for them. */
  guardianGuestId?: GuestId;
  guardianRelation?: GuardianRelation;

  /** Absent = not signed: a guarded minor, or a roster-mode row. */
  signedAt?: string;
  waiverTemplateId?: WaiverTemplateId;
  /** The name as typed. */
  signatureName?: string;
  /** Evidence a real device signed. Cleared by retention. */
  signedIp?: string;
  signedUserAgent?: string;

  /** Set when crew tick the guest aboard; absent when not. */
  checkedIn?: { at: string; by: CrewMemberId };

  source: GuestSource;
  createdAt: string;
}

/**
 * The passenger count the mate sets for a departure — the current value only, no history. It is
 * editable at any time (operator, 2026-09-29). Never above the boat's COI limit; the rule that
 * enforces that lives where the count is set, not in storage.
 */
export interface DepartureCount {
  pax: number;
  /** ISO-8601 UTC of the latest set. */
  countedAt: string;
  countedBy: CrewMemberId;
}

/**
 * The module's operator settings, stored as `checkin.*` keys in `app_settings` and read through a
 * typed port — the `getPaymentConfig` pattern. An absent key falls to the default below.
 */
export interface CheckInConfig {
  /** Birthdays before this many years ago make an adult. */
  ageOfMajority: number;
  /** Days before departure the booker is reminded, largest first. */
  reminderDaysBefore: readonly number[];
  /** Whether guest rows exist before they sign (spec §6). Off for BrewBoat. */
  rosterMode: boolean;
}

/** Operator-approved defaults, 2026-09-29: 18, and Xola's 7 / 3 / 1-day reminders. */
export const CHECK_IN_CONFIG_DEFAULTS: CheckInConfig = {
  ageOfMajority: 18,
  reminderDaysBefore: [7, 3, 1],
  rosterMode: false,
};

/**
 * Whatever was stored, as a usable config: each field that is absent or not valid falls to its
 * default, per field (DEC-054's absent-means-default idiom). **Both adapters read through this**,
 * so a bad value reads back the same from Postgres and from the in-memory double — they disagreed
 * until `@code-review` caught it on 18.1.
 *
 * `reminderDaysBefore` is all-or-nothing: one bad entry drops the whole list to the default, never
 * a half-kept schedule.
 */
export function normalizeCheckInConfig(stored: {
  ageOfMajority?: unknown;
  reminderDaysBefore?: unknown;
  rosterMode?: unknown;
}): CheckInConfig {
  const positiveInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;
  const days = stored.reminderDaysBefore;
  return {
    ageOfMajority: positiveInt(stored.ageOfMajority)
      ? stored.ageOfMajority
      : CHECK_IN_CONFIG_DEFAULTS.ageOfMajority,
    reminderDaysBefore:
      Array.isArray(days) && days.every(positiveInt) ? [...days] : CHECK_IN_CONFIG_DEFAULTS.reminderDaysBefore,
    rosterMode:
      typeof stored.rosterMode === "boolean" ? stored.rosterMode : CHECK_IN_CONFIG_DEFAULTS.rosterMode,
  };
}
