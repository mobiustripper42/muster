/**
 * The customer booking code (#741, DEC-154) — the short credential that replaced DEC-122's
 * stateless HMAC capability URL.
 *
 * `https://muster.brewcle.com/b/K3F9QZ2MX7RN4P` — 43 characters, against 129 for the URL it
 * replaces. That link ships in the confirmation SMS, where length is billed in segments.
 *
 * **A booking code is a CREDENTIAL, not an identifier.** It is the nearest thing in this repo to
 * `mintDisplayCode` (`src/customers/identity.ts`) and it deliberately differs in two ways:
 *
 *  - **Randomness comes from a CSPRNG, never `Math.random`.** A display code only has to be
 *    unique — a predictable one costs nothing. Predicting a booking code opens someone else's
 *    booking. The generator is injected (house style, deterministic tests) but the default and
 *    every production path is `crypto.randomBytes`.
 *  - **Length is sized against GUESSING, not collision.** 14 chars of Crockford base32 is ~70
 *    bits. The threat is not guessing one particular booking's code, it is hitting ANY live one,
 *    so the search space divides by the number of live bookings: at 10,000 live bookings and a
 *    sustained 1,000 guesses/sec, expected time to a first hit is ~3.7 million years (at 8 chars
 *    it would be ~30 hours). The 43-char HMAC this replaces was never sized at all — it was
 *    base64url of SHA-256 because that is what SHA-256 emits.
 *
 * Length is the floor, not the whole defence: revocation kills a leaked code and expiry bounds
 * the window, both of which the HMAC had no way to do (`booking_codes` rows carry `revokedAt`
 * and `expiresAt`). Rate-limiting the lookup is not a substitute for either.
 */

import { randomBytes } from "node:crypto";
import type { BookingCode } from "../domain/entities.js";

/** Crockford base32 — reused verbatim from the display-code alphabet (`customers/identity.ts`):
 *  I/L/O drop because they collide with 1/1/0 read aloud or handwritten, U drops so the encoding
 *  cannot spell an obscenity. A booking code is usually tapped, not typed, but a customer reading
 *  one off a text to someone on the phone is exactly the recovery case that matters. */
export const BOOKING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 14 chars ⇒ 32^14 ≈ 2^70. Decided deliberately (#741), not derived from a hash width. */
export const BOOKING_CODE_LENGTH = 14;

const BOOKING_CODE_RE = new RegExp(`^[${BOOKING_CODE_ALPHABET}]{${BOOKING_CODE_LENGTH}}$`);

/**
 * Mint a code from cryptographic randomness. `bytes` is injected only so tests can pin the
 * output; it defaults to `crypto.randomBytes` and no caller should pass anything weaker.
 *
 * The alphabet is 32 characters and a byte holds 256 values, so `byte & 31` is exactly uniform —
 * no modulo bias and no rejection sampling. (A 33-character alphabet would need both, which is a
 * reason beyond readability not to add a character.)
 *
 * Uniqueness is the DATABASE's job: `booking_codes.code` is the primary key and the caller
 * retries on conflict (DEC-131 — structural invariants belong in storage). Trusting a
 * "probably unique" value minted in TS is how duplicates ship.
 */
export function mintBookingCode(bytes: (n: number) => Buffer = randomBytes): string {
  const buf = bytes(BOOKING_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < BOOKING_CODE_LENGTH; i++) {
    out += BOOKING_CODE_ALPHABET[(buf[i] ?? 0) & 31];
  }
  return out;
}

/** `true` for a well-formed code — anchored, so no partial match. */
export function isBookingCode(value: string): boolean {
  return BOOKING_CODE_RE.test(value);
}

/**
 * Normalize a code arriving from a URL for lookup: uppercase, and fold the characters the
 * alphabet excludes (I/L → 1, O → 0) so a code read aloud and re-typed still resolves. Returns
 * null when it cannot be a code — the caller renders the generic invalid state rather than
 * hitting the database with a 400-character path segment.
 *
 * Deliberately NOT a redirect to the canonical form: that would bounce the credential through a
 * `Location` header (and any log that records one) for a cosmetic gain.
 */
export function normalizeBookingCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/[^0-9A-Z]/g, "");
  return isBookingCode(cleaned) ? cleaned : null;
}

/**
 * The customer's booking URL. `base` is injected — the trusted `APP_BASE_URL` at the edge, never
 * a Host header (`app/lib/base-url.ts`), which is how a manage link would otherwise get minted
 * against an attacker-supplied origin.
 */
export function bookingUrl(base: string, code: string): string {
  return `${base.replace(/\/+$/, "")}/b/${code}`;
}

/**
 * Why a code will not open a booking, or `null` if it will.
 *
 * `revoked` and `expired` are kept distinct from "unknown" by the caller, which renders them
 * differently on purpose: whoever holds a revoked code already knew the booking existed, so
 * telling them it was replaced leaks nothing and is the only way they learn to ask for a new
 * one. An unknown code gets the generic state, which never confirms a booking exists.
 */
export type BookingCodeRefusal = "revoked" | "expired";

export function bookingCodeRefusal(row: BookingCode, nowIso: string): BookingCodeRefusal | null {
  if (row.revokedAt) return "revoked";
  // String comparison is correct for ISO-8601 UTC and is the codebase's idiom (clock injected,
  // timestamps stored verbatim). `expiresAt` is unset today — nothing mints an expiring code —
  // but the column and this guard exist so a policy is a value, not a migration.
  if (row.expiresAt && row.expiresAt <= nowIso) return "expired";
  return null;
}
