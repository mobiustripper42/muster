/**
 * The payment link (issue #1082 part B, SPEC §2.10.6) — how a customer pays a booking the operator
 * took by phone. `/pay/<reservationId>.<expiry>.<sig>`.
 *
 * **Stateless and signed; nothing is stored.** §2.10.6: "the link is minted fresh each time it is
 * asked for and carries no durable token of its own, so it always reflects what is currently owed."
 * The signature is an HMAC-SHA256 over `SESSION_SECRET` (the secret the session cookie already
 * uses, `app/lib/auth.ts`), compared in constant time as `src/auth/session.ts` does. Minting one is
 * therefore free and writes nothing, and a new one does not kill an old one — each simply runs out.
 *
 * **Not the booking link.** `/b/<code>` is the customer's durable credential for managing a paid
 * booking (§2.8.11). This one is a short-lived address for money still owed, and it never leads to
 * `/b/<code>`: a paid booking's pay page says it is paid and points at `/b/find`, so whoever holds a
 * forwarded payment link does not inherit the booking.
 *
 * **The message is prefixed** (`pay-link:v1:`) so nothing else signed under the same secret — a
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

const PURPOSE = "pay-link:v1";

function signature(reservationId: string, expirySeconds: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}:${reservationId}:${expirySeconds}`).digest("base64url");
}

/** A link for this booking that works for {@link PAYMENT_LINK_HOURS} from `now`. The token only —
 *  {@link paymentLinkUrl} puts it on the trusted origin. */
export function signPaymentLink(reservationId: string, now: Date, secret: string): string {
  const expirySeconds = String(Math.floor(now.getTime() / 1000) + PAYMENT_LINK_HOURS * 3600);
  return `${reservationId}.${expirySeconds}.${signature(reservationId, expirySeconds, secret)}`;
}

export type PaymentLinkFailure = "malformed" | "bad_signature" | "expired";

export type PaymentLinkCheck =
  | { ok: true; reservationId: ReservationId; expiresAt: Date }
  | { ok: false; reason: PaymentLinkFailure };

/**
 * Well-formed → signature valid (constant time) → not expired. The signature is checked before the
 * expiry is trusted, so a stretched expiry reads as tampered rather than as live.
 *
 * Split from the right: the id is everything before the last two dots, so an id that ever carried a
 * dot would still round-trip. Admin rows are `resv-<hex>` today.
 */
export function verifyPaymentLink(token: string, secret: string, now: Date): PaymentLinkCheck {
  const sigDot = token.lastIndexOf(".");
  const expiryDot = sigDot > 0 ? token.lastIndexOf(".", sigDot - 1) : -1;
  if (expiryDot <= 0) return { ok: false, reason: "malformed" };
  const reservationId = token.slice(0, expiryDot);
  const expirySeconds = token.slice(expiryDot + 1, sigDot);
  const sig = token.slice(sigDot + 1);
  if (!/^\d{1,12}$/.test(expirySeconds) || sig === "") return { ok: false, reason: "malformed" };

  const a = Buffer.from(sig);
  const b = Buffer.from(signature(reservationId, expirySeconds, secret));
  // Mismatched lengths can't be compared in constant time, so they are refused first.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  const expiresAt = new Date(Number(expirySeconds) * 1000);
  if (now.getTime() >= expiresAt.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, reservationId: asId<"ReservationId">(reservationId), expiresAt };
}

/** The customer-facing URL. `base` must be the trusted origin (`APP_BASE_URL`), never a Host
 *  header — the same rule as every link the product sends (`app/lib/base-url.ts`). */
export function paymentLinkUrl(base: string, token: string): string {
  return `${base}/pay/${token}`;
}
