/**
 * The payment link (issue #1082 part B, SPEC §2.10.6) — how a customer pays a booking the operator
 * took by phone. `/p/<id>.<expiry>.<sig>`, about 55 characters after the host.
 *
 * **Stateless and signed; nothing is stored.** §2.10.6: "the link is minted fresh each time it is
 * asked for and carries no durable token of its own, so it always reflects what is currently owed."
 * The signature is an HMAC-SHA256 over `SESSION_SECRET` (the secret the session cookie already
 * uses, `app/lib/auth.ts`), compared in constant time as `src/auth/session.ts` does. Minting one is
 * therefore free and writes nothing, and a new one does not kill an old one — each simply runs out.
 *
 * **Packed, because it is texted** (operator, 2026-09-29: the first form ran 97 characters after
 * the host). Each part is the short spelling of the same fact:
 * - `id`: the booking's 32 hex digits as 22 base64url characters. Only an operator's booking gets a
 *   link, and those ids are always `resv-<32 hex>` (`mintPendingReservationId`), so the prefix is
 *   implied rather than spelled.
 * - `expiry`: Unix seconds in base 36 — six characters until the 2090s.
 * - `sig`: the HMAC's first 128 bits in base64url. Truncating an HMAC is standard (NIST SP 800-107),
 *   and 128 bits is far past guessing over the network.
 *
 * **Not the booking link.** `/b/<code>` is the customer's durable credential for managing a paid
 * booking (§2.8.11). This one is a short-lived address for money still owed, and it never leads to
 * `/b/<code>`: a paid booking's pay page says it is paid and points at `/b/find`, so whoever holds a
 * forwarded payment link does not inherit the booking.
 *
 * **The message is prefixed** (`pay-link:v2:`) so nothing else signed under the same secret — a
 * session token today, anything tomorrow — can be replayed as a payment link.
 *
 * Framework-free: pure `node:crypto`, the clock passed in.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { asId, type ReservationId } from "../domain/ids.js";

/**
 * How long a payment link works. A code constant, not an environment variable: the customer is told
 * the number ("The link works for 72 hours") and §2.10.6 states it, so a deploy must not be able to
 * change it out from under both.
 */
export const PAYMENT_LINK_HOURS = 72;

const PURPOSE = "pay-link:v2";
const ADMIN_ID = /^resv-([0-9a-f]{32})$/;
const PACKED_ID = /^[\w-]{22}$/;
const EXPIRY = /^[0-9a-z]{1,8}$/;
const SIG = /^[\w-]{22}$/;

/** The HMAC's first 16 bytes, over the unpacked id and the expiry in decimal seconds. */
function signature(reservationId: string, expirySeconds: number, secret: string): Buffer {
  return createHmac("sha256", secret).update(`${PURPOSE}:${reservationId}:${expirySeconds}`).digest().subarray(0, 16);
}

/** A link for this booking that works for {@link PAYMENT_LINK_HOURS} from `now`. The token only —
 *  {@link paymentLinkUrl} puts it on the trusted origin. Throws for an id that isn't an operator
 *  booking's shape: nothing else is ever sent a payment link. */
export function signPaymentLink(reservationId: string, now: Date, secret: string): string {
  const hex = ADMIN_ID.exec(reservationId)?.[1];
  if (!hex) throw new Error(`a payment link names an operator booking (resv-<32 hex>), not ${reservationId}`);
  const expirySeconds = Math.floor(now.getTime() / 1000) + PAYMENT_LINK_HOURS * 3600;
  const id = Buffer.from(hex, "hex").toString("base64url");
  const sig = signature(reservationId, expirySeconds, secret).toString("base64url");
  return `${id}.${expirySeconds.toString(36)}.${sig}`;
}

export type PaymentLinkFailure = "malformed" | "bad_signature" | "expired";

export type PaymentLinkCheck =
  | { ok: true; reservationId: ReservationId; expiresAt: Date }
  | { ok: false; reason: PaymentLinkFailure };

/**
 * Well-formed → signature valid (constant time) → not expired. The signature is checked before the
 * expiry is trusted, so a stretched expiry reads as tampered rather than as live.
 *
 * Only the canonical spelling of each part is accepted: 22 base64url characters hold 132 bits for
 * 128, so a second spelling of the same id exists, and a link has exactly one.
 */
export function verifyPaymentLink(token: string, secret: string, now: Date): PaymentLinkCheck {
  const [id, expiry, sig, ...rest] = token.split(".");
  if (rest.length > 0 || !id || !expiry || !sig) return { ok: false, reason: "malformed" };
  if (!PACKED_ID.test(id) || !EXPIRY.test(expiry) || !SIG.test(sig)) return { ok: false, reason: "malformed" };
  const idBytes = Buffer.from(id, "base64url");
  const expirySeconds = parseInt(expiry, 36);
  if (idBytes.toString("base64url") !== id || expirySeconds.toString(36) !== expiry) {
    return { ok: false, reason: "malformed" };
  }
  const reservationId = `resv-${idBytes.toString("hex")}`;

  const given = Buffer.from(sig, "base64url");
  const expected = signature(reservationId, expirySeconds, secret);
  // Mismatched lengths can't be compared in constant time, so they are refused first. The
  // signature's last character has spare bits too, so an edit there can decode to the same bytes:
  // only the canonical spelling counts, or a hand-edited link would still verify.
  if (
    given.toString("base64url") !== sig ||
    given.length !== expected.length ||
    !timingSafeEqual(given, expected)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  const expiresAt = new Date(expirySeconds * 1000);
  if (now.getTime() >= expiresAt.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, reservationId: asId<"ReservationId">(reservationId), expiresAt };
}

/** The customer-facing URL. `base` must be the trusted origin (`APP_BASE_URL`), never a Host
 *  header — the same rule as every link the product sends (`app/lib/base-url.ts`). */
export function paymentLinkUrl(base: string, token: string): string {
  return `${base}/p/${token}`;
}
