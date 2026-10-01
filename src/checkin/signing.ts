/**
 * The signing rules (Phase 18.4, issue #1118) — what one submitted waiver form becomes. The page is
 * `app/w/[code]`; the spec is `docs/design/check-in-surfaces.md` §A and
 * `docs/design/check-in-and-waivers.md` §6.
 *
 * **One signing writes one adult row and N child rows, together.** The adult signs (the typed name,
 * the waiver version, the device). Children do not sign: each points at the adult, unsigned, and
 * counts as covered. The parent always sails with the child (operator, 2026-09-30), so *Me + my
 * kids* and *A child (under 18)* write exactly the same rows; only the label the guest picked
 * differs.
 *
 * **Nothing is ever merged.** A shared phone or email is normal (couples, families passing one
 * phone down the line), so every signing is new rows. A duplicate costs nothing.
 *
 * **Minor or adult is worked out from the date of birth**, against the operator's age of majority
 * on the day of signing (boat time), and frozen on the row. The year selects already keep each
 * block on its side of the line; this checks again, because a form is whatever the client sent.
 *
 * Business rules live here, never in the tables (DEC-131).
 */
import { canonicalizePhone } from "../customers/identity.js";
import type { Reservation } from "../domain/entities.js";
import { asId, type EventId, type ReservationId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import type { RateLimitPolicy } from "../rate-limit/rate-limit.js";
import type { Guest, WaiverTemplate } from "./entities.js";

/**
 * Signatures per client address per minute (DEC-189). Above a gangway crowd on one Wi-Fi; a refused
 * submit comes back with everything typed. Fails open: a broken counter must never stop a guest
 * signing at the dock.
 */
export const SIGNING_LIMIT: RateLimitPolicy = {
  bucket: "waiver-sign",
  limit: 20,
  windowMs: 60_000,
  failOpen: true,
};

/** One adult signs for at most ten children in one go (spec §6). */
export const MAX_CHILDREN = 10;
/** How far back an adult's birth-year list reaches. */
export const OLDEST_AGE = 110;
const MAX_NAME = 100;

/** Who the guest said they are signing for (step 1). */
export type SigningPath = "me" | "kids" | "child";

/** A date of birth as the three selects send it. A blank select arrives as NaN. */
export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** One submitted form, already read off the request but not yet checked. */
export interface SigningForm {
  path: SigningPath;
  /** The booking the guest is with, or null for a walk-up. */
  reservationId: ReservationId | null;
  /**
   * The waiver version the form showed. The row must record the words the guest READ, so a
   * version posted while they were typing refuses the signing rather than being recorded against
   * text they never saw (security review, 18.4).
   */
  shownTemplateId: string;
  adult: {
    name: string;
    legalNameConfirmed: boolean;
    dob: DateParts;
    email: string;
    /** Optional: blank is fine. */
    phone: string;
  };
  children: { name: string; dob: DateParts }[];
  /** The e-sign consent box. */
  consent: boolean;
}

export interface SigningContext {
  eventId: EventId;
  /** The version in force now, or null when none has been posted. */
  template: WaiverTemplate | null;
  ageOfMajority: number;
  /** Boat-local `YYYY-MM-DD` — the day ages are measured on. */
  today: string;
  /** ISO-8601 UTC — stamped as signed and created. */
  now: string;
  /** The bookings on this departure that are still booked; a guest can only join one of these. */
  bookedReservationIds: readonly ReservationId[];
  /** Evidence a real device signed (spec §6). Absent when not known. */
  ip?: string | undefined;
  userAgent?: string | undefined;
  newId: () => string;
}

export type SigningError =
  | "no_waiver"
  | "waiver_changed"
  | "bad_party"
  | "bad_kids_count"
  | "bad_name"
  | "legal_name_unconfirmed"
  | "bad_dob"
  | "adult_too_young"
  | "bad_email"
  | "bad_phone"
  | "bad_child_name"
  | "bad_child_dob"
  | "child_too_old"
  | "consent_required";

export type SigningResult = { ok: true; rows: Guest[] } | { ok: false; code: SigningError };

/** The checks in the order a guest meets the fields, so the first refusal is the topmost one. */
export function buildSigning(form: SigningForm, ctx: SigningContext): SigningResult {
  const fail = (code: SigningError): SigningResult => ({ ok: false, code });
  const template = ctx.template;
  if (!template) return fail("no_waiver");
  if (form.shownTemplateId !== template.id) return fail("waiver_changed");
  if (form.reservationId !== null && !ctx.bookedReservationIds.includes(form.reservationId)) {
    return fail("bad_party");
  }
  const kidCount = form.children.length;
  if (form.path === "me" ? kidCount !== 0 : kidCount < 1 || kidCount > MAX_CHILDREN) {
    return fail("bad_kids_count");
  }

  const name = tidyName(form.adult.name);
  if (!name) return fail("bad_name");
  if (!form.adult.legalNameConfirmed) return fail("legal_name_unconfirmed");
  const adultDob = isoDate(form.adult.dob, ctx.today);
  if (!adultDob) return fail("bad_dob");
  if (ageOn(adultDob, ctx.today) < ctx.ageOfMajority) return fail("adult_too_young");
  const email = form.adult.email.trim().toLowerCase();
  if (!looksLikeEmail(email)) return fail("bad_email");
  let phone: string | undefined;
  if (form.adult.phone.trim()) {
    const p = canonicalizePhone(form.adult.phone);
    if (!p.ok) return fail("bad_phone");
    phone = p.phone;
  }

  const children: { name: string; dob: string }[] = [];
  for (const c of form.children) {
    const childName = tidyName(c.name);
    if (!childName) return fail("bad_child_name");
    const childDob = isoDate(c.dob, ctx.today);
    if (!childDob) return fail("bad_child_dob");
    if (ageOn(childDob, ctx.today) >= ctx.ageOfMajority) return fail("child_too_old");
    children.push({ name: childName, dob: childDob });
  }
  if (!form.consent) return fail("consent_required");

  const booking = form.reservationId ? { reservationId: form.reservationId } : {};
  const adult: Guest = {
    id: asId<"GuestId">(ctx.newId()),
    eventId: ctx.eventId,
    ...booking,
    name,
    email,
    ...(phone ? { phone } : {}),
    dob: adultDob,
    isMinor: false,
    signedAt: ctx.now,
    waiverTemplateId: template.id,
    signatureName: name,
    ...(ctx.ip ? { signedIp: ctx.ip } : {}),
    ...(ctx.userAgent ? { signedUserAgent: ctx.userAgent } : {}),
    source: "self",
    createdAt: ctx.now,
  };
  // The adult comes first: each child's `guardian_guest_id` points at it, and the rows are written
  // in this order inside one transaction.
  const kids: Guest[] = children.map((c) => ({
    id: asId<"GuestId">(ctx.newId()),
    eventId: ctx.eventId,
    ...booking,
    name: c.name,
    dob: c.dob,
    isMinor: true,
    guardianGuestId: adult.id,
    source: "self",
    createdAt: ctx.now,
  }));
  return { ok: true, rows: [adult, ...kids] };
}

/** Check and write one signing. Nothing is written when it is refused. */
export async function signAndSave(
  repo: Repository,
  form: SigningForm,
  ctx: SigningContext,
): Promise<{ ok: true; signer: Guest } | { ok: false; code: SigningError }> {
  const r = buildSigning(form, ctx);
  if (!r.ok) return r;
  await repo.saveGuests(r.rows);
  return { ok: true, signer: r.rows[0]! };
}

/** One `@`, something before it, and a dotted domain after it — no spaces anywhere. Nothing
 *  verifies the address (spec §6); this only catches a typo like a missing domain. */
function looksLikeEmail(email: string): boolean {
  if (/\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  const labels = domain.split(".");
  return local.length > 0 && labels.length >= 2 && labels.every((l) => l.length > 0);
}

function tidyName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return name && name.length <= MAX_NAME ? name : null;
}

/** The parts as `YYYY-MM-DD` when they make a real date that is not in the future and not older
 *  than the year list reaches; otherwise null. */
function isoDate(d: DateParts, today: string): string | null {
  if (![d.year, d.month, d.day].every(Number.isInteger)) return null;
  const iso = `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  if (iso > today) return null;
  if (d.year < Number(today.slice(0, 4)) - OLDEST_AGE) return null;
  return iso;
}

/** Whole years from `dob` to `today` (both `YYYY-MM-DD`). A 29 February birthday ticks over on
 *  1 March in a common year. */
export function ageOn(dob: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  return today.slice(5) < dob.slice(5) ? years - 1 : years;
}

/**
 * The birth-year select, newest first. An adult's starts at the age of majority; a child's ends
 * there. The boundary year is in both, because someone born that year is on one side or the other
 * depending on the day, and the check above settles which.
 */
export function birthYearOptions(kind: "adult" | "child", today: string, ageOfMajority: number): number[] {
  const year = Number(today.slice(0, 4));
  const [from, to] = kind === "adult" ? [year - ageOfMajority, year - OLDEST_AGE] : [year, year - ageOfMajority];
  return Array.from({ length: from - to + 1 }, (_, i) => from - i);
}

/**
 * "Your group: 14 of 16 signed." Every row on the booking counts: a signed adult, and a child
 * covered by one. Duplicates can push the rows past the party, so the count stops at the party
 * size — and both numbers stop at the boat's passenger limit, because nothing the module shows
 * may exceed it (spec §4a).
 */
export function groupCoverage(
  partySize: number,
  rowsForBooking: number,
  coiMaxPax: number,
): { covered: number; of: number; remaining: number } {
  const of = Math.max(0, Math.min(partySize, coiMaxPax));
  const covered = Math.min(rowsForBooking, of);
  return { covered, of, remaining: of - covered };
}

/** "Who are you here with?" — booked parties by surname only, alphabetically (spec §A2). */
export function partyChoices(
  reservations: readonly Reservation[],
): { reservationId: ReservationId; surname: string; partySize: number }[] {
  return reservations
    .filter((r) => r.status === "booked")
    .map((r) => ({ reservationId: r.id, surname: surnameOf(r.customerName), partySize: r.partySize }))
    .sort((a, b) => a.surname.localeCompare(b.surname));
}

function surnameOf(name: string): string {
  return name.trim().split(/\s+/).at(-1) || "Guest";
}

/** What the signing page and the sign action both need about one departure. */
export interface SigningScene {
  /** Still-booked parties on the departure. */
  reservations: Reservation[];
  /** The waiver in force at `now`, or null when none has been posted. */
  template: WaiverTemplate | null;
  ageOfMajority: number;
  /** The boat's passenger limit, which no number on the page may exceed (spec §4a). Falls back to
   *  the departure's capacity if the boat's row is gone. */
  coiMaxPax: number;
}

export async function loadSigningScene(repo: Repository, eventId: EventId, now: string): Promise<SigningScene> {
  const [event, reservations, template, config] = await Promise.all([
    repo.getEvent(eventId),
    repo.listReservationsForEvent(eventId),
    repo.getCurrentWaiverTemplate(now),
    repo.getCheckInConfig(),
  ]);
  const vessel = event ? await repo.getVessel(event.vesselId) : null;
  return {
    reservations: reservations.filter((r) => r.status === "booked"),
    template,
    ageOfMajority: config.ageOfMajority,
    coiMaxPax: vessel?.coiMaxPax ?? event?.capacity ?? 0,
  };
}

/**
 * Which booking a guest is signing with (spec §A2). `party` is what the guest picked: a booking id
 * on this departure, or `walkup`.
 *
 * - No bookings: a walk-up.
 * - A pick that is still booked: that booking. `walkup`: a walk-up.
 * - A pick that is NOT still booked — cancelled while they typed — means choose again. Never a
 *   silent swap into the one booking left: that would count a stranger in someone else's group.
 * - No pick: one booking (a private charter, BrewBoat's whole trade) is that booking, and no party
 *   step is shown; several mean choose.
 */
export function partyFor(
  reservations: readonly Reservation[],
  party: string | undefined,
): ReservationId | null | "choose" {
  if (reservations.length === 0 || party === "walkup") return null;
  if (party) return reservations.find((r) => r.id === party)?.id ?? "choose";
  return reservations.length === 1 ? reservations[0]!.id : "choose";
}
