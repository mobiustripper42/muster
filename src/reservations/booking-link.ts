/**
 * The customer "manage my booking" capability URL (11.4, DEC-122).
 *
 * A STATELESS HMAC capability, not a stored token and not a magic link:
 *   token = base64url(HMAC-SHA256(secret, "reservation-link:v1:" + reservationId))
 *
 * Why not `issueMagicLink` (the crew path): that token is single-use — consumed
 * on first verify (CAS). A "manage my booking" link must be re-openable, so it
 * needs bearer-capability semantics (the URL IS the credential, repeatable), like
 * the DEC-098 crew feed — but here with NO stored row at all. The link is a pure
 * function of the reservation id + a dedicated `RESERVATION_LINK_SECRET`, so the
 * verifier (the P12 manage page) re-derives and constant-time-compares; nothing
 * is written, no migration.
 *
 * Tradeoff on the record (DEC-122): no per-single-link revocation — a leaked link
 * dies only by rotating the secret (which invalidates every booking link, but NOT
 * sessions: the secret is dedicated, not `SESSION_SECRET`). Accepted because the
 * protected asset is view + request-cancel-out-of-band; money already moved
 * through Stripe. A stored-token upgrade is a P12 drop-in if a threat model needs
 * revocation — this module is the only thing that would change.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ReservationId } from "../domain/ids.js";

/** Domain-separation tag — keeps this HMAC from ever colliding with another use
 *  of the same root secret, and carries a version for a future scheme change. */
const LINK_PURPOSE = "reservation-link:v1";

/** The opaque bearer token for a reservation's manage link (256-bit, base64url). */
export function reservationLinkToken(
  reservationId: ReservationId,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${LINK_PURPOSE}:${reservationId}`)
    .digest("base64url");
}

/**
 * The full manage URL for a reservation. `linkBase` is injected (the trusted
 * `APP_BASE_URL` at the edge — service-layer never reads the Host header). The
 * manage page is P12; this only generates the link 11.4 emits.
 */
export function reservationManageUrl(
  linkBase: string,
  reservationId: ReservationId,
  secret: string,
): string {
  const base = linkBase.replace(/\/+$/, "");
  const token = reservationLinkToken(reservationId, secret);
  return `${base}/reservations/manage?r=${encodeURIComponent(reservationId)}&t=${token}`;
}

/**
 * Verify a presented token against a reservation id (the P12 manage page's guard,
 * paired here so the scheme is a complete, testable unit). Constant-time compare —
 * a length-mismatch short-circuits before `timingSafeEqual` (which throws on
 * unequal lengths), and that's not a timing leak: token length is fixed.
 */
export function verifyReservationLinkToken(
  reservationId: ReservationId,
  secret: string,
  presented: string,
): boolean {
  const expected = Buffer.from(reservationLinkToken(reservationId, secret));
  const got = Buffer.from(presented);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
