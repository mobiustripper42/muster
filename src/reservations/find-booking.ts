/**
 * Booking recovery matching (12.7, issue #460) — the pure half of "lost your link?".
 *
 * A customer who deleted the confirmation text has no code, so there is no credential to present.
 * What they can supply is the contact we already hold and their name. This decides which booking
 * that refers to; the caller mints/reads the code and sends the link **to the contact on file**.
 *
 * **The name is friction, not authentication.** The link is only ever sent to the stored contact,
 * never rendered from typed input — so the worst a stranger achieves by guessing a phone number
 * is causing the real customer to receive a text they didn't ask for. Given that, the name check
 * exists to make casual poking pointless, and being strict about it would only fail honest
 * customers. `Reservation.customerName` is a single string with no first/last split, so "last
 * name" can only ever be a guess at tokenization ("Ana Maria de la Cruz" has no right answer) —
 * any token matches.
 *
 * **The caller must not vary its response on the result.** Returning `null` and returning a match
 * have to look identical to the person at the form, or this becomes an oracle for "does this
 * person have a booking with you". That is the same reasoning `src/auth/login-code.ts` records
 * for its single generic failure.
 */

import type { Event, Reservation } from "../domain/entities.js";
import { canonicalizePhone } from "../customers/identity.js";

/** A reservation joined to its departure — the deriver needs the date to pick "soonest". */
export interface RecoveryRow {
  reservation: Reservation;
  event: Event;
}

export interface RecoveryQuery {
  /** Email or phone, as typed. Which one it is is inferred, not asked. */
  contact: string;
  /** "Last name", as asked for on the form. Matched against ANY token of the stored name. */
  lastName: string;
}

/**
 * The booking a recovery request refers to, or `null`.
 *
 * `today` is the vessel-local day (DEC-032), injected — the core stays clock-free.
 */
export function matchBookingForRecovery(
  rows: readonly RecoveryRow[],
  query: RecoveryQuery,
  today: string,
): RecoveryRow | null {
  const name = query.lastName.trim().toLowerCase();
  if (!name) return null;

  const contact = query.contact.trim();
  if (!contact) return null;
  // An `@` is the only signal needed: a phone number never contains one, and an email always
  // does. Anything that is neither a usable email nor a canonicalizable phone matches nothing —
  // refused rather than compared loosely, because a loose compare here reaches a real person's
  // phone.
  const isEmail = contact.includes("@");
  const email = isEmail ? contact.toLowerCase() : null;
  const phone = isEmail ? null : canonicalizePhone(contact);
  if (!email && !phone?.ok) return null;

  const candidates = rows.filter(({ reservation }) => {
    // Xola holds its own bookings (DEC-105) — there is no Muster link to recover for one.
    if (reservation.source !== "muster") return false;
    if (!nameMatches(reservation.customerName, name)) return false;
    if (email) return reservation.email?.trim().toLowerCase() === email;
    // Canonicalize BOTH sides through the same function the booking form uses, so the stored
    // "(440) 555-0102" and a typed "+14405550102" are one number rather than two strings.
    const stored = canonicalizePhone(reservation.phone);
    return stored.ok && phone?.ok === true && stored.phone === phone.phone;
  });
  if (candidates.length === 0) return null;

  // A cancelled booking is still recoverable — its receipt lives behind the same link — but it
  // must never be handed back while a live booking exists for the same person.
  const live = candidates.filter((c) => c.reservation.status !== "cancelled");
  const pool = live.length > 0 ? live : candidates;

  // Soonest upcoming first; failing that, the most recent past. Someone asking for their link is
  // almost always asking about the trip they are about to take, and handing them a booking from
  // last spring is a match that helps nobody.
  const upcoming = pool
    .filter((c) => c.event.date >= today)
    .sort((a, b) => a.event.date.localeCompare(b.event.date));
  if (upcoming.length > 0) return upcoming[0]!;

  return [...pool].sort((a, b) => b.event.date.localeCompare(a.event.date))[0]!;
}

/** True when `typed` equals any whitespace-separated token of the stored name. */
function nameMatches(stored: string | undefined, typed: string): boolean {
  if (!stored) return false;
  return stored
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .some((token) => token === typed);
}
