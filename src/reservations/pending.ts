/**
 * The pending row's clock (14.4, SPEC §2.8.1) — PURE, no repo.
 *
 * A `pending` reservation is live for the **payment window** after it was written, then lapsed.
 * Lapsed is never stored (§2.8.1): every reader computes it from `reservedAt` and the window,
 * and every reader must compute it the SAME way — the deriver, the hold acquirer, and both
 * adapters' write-side checks. This module is where that one rule lives.
 *
 * **Two things called "hold minutes" meet here, and they are not the same number.**
 *
 *   - `PAYMENT_WINDOW_MINUTES` below — how long a customer has to pay before their row lapses.
 *     15 minutes (DEC-109). The code has called this `HOLD_MINUTES` since 12.1, because it is
 *     also the `checkout_holds` TTL, and it stays exported under that name from `claim.ts` for
 *     every existing reader. `CHECKOUT_HOLD_MINUTES` overrides it outside production.
 *   - `Reservation.holdMinutes` — how long the HULL is committed for a departure, frozen from
 *     `Offering.holdMinutes` (DEC-161). Two hours for a hundred-minute trip, say. That is a
 *     property of the boat's day, not of the customer's checkout, and it lives in `hull-busy.ts`.
 *
 * New code names the window `PAYMENT_WINDOW_MINUTES`. Nothing is renamed.
 */
import { isProdDeploy } from "../config/deploy.js";
import type { Reservation } from "../domain/entities.js";

/** The soft-hold lifetime (DEC-109). Lifted from sailbook's proven 15 min. */
export const HOLD_MINUTES_DEFAULT = 15;

/**
 * The hold lifetime, **overridable outside production only** (`CHECKOUT_HOLD_MINUTES`).
 *
 * **Why this exists.** The residual race (DEC-109) — hold expires mid-payment, a rival takes the
 * freed slot and pays first, the first payment then lands — is reachable by clicking, because
 * that is how the app works. It is just not reachable *on demand*: at 15 minutes, reproducing it
 * by hand means two browsers and a fifteen-minute wait, so in practice nobody ever checks it.
 * `CHECKOUT_HOLD_MINUTES=0.5` turns that into a two-minute job with two browser windows. Same
 * move sailbook made (operator, 2026-08-05), and it is why #613's handling is testable at all
 * rather than only assertable.
 *
 * Fractions are allowed on purpose — 0.5 is thirty seconds, which is the useful setting. Garbage
 * and non-positive values fall back rather than throwing: a typo must not mint a zero-length
 * hold, which would make every buyer lose the race to themselves.
 *
 * **Ignored outright on a production deploy.** Shortening a real buyer's hold means their slot is
 * released while their card is still processing — manufacturing the exact race this constant
 * exists to bound. The guard is not a style preference; a stray env var on prod would cost real
 * customers real bookings.
 */
export function resolveHoldMinutes(): number {
  if (isProdDeploy()) return HOLD_MINUTES_DEFAULT;
  const raw = process.env.CHECKOUT_HOLD_MINUTES;
  if (!raw) return HOLD_MINUTES_DEFAULT;
  // The same poison-resistant shape as `tenant.ts`'s `envMs` and `derive.ts`'s
  // `envPositiveNumber`, spelled here rather than reused: both are private to their modules and
  // named for units this is not (milliseconds, counts). Exporting one under a misleading name to
  // save four lines would trade a small duplication for a worse one. `isProdDeploy` above was a
  // different case — one predicate, one meaning, and a documented history of drifting copies.
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : HOLD_MINUTES_DEFAULT;
}

/** Resolved once at import — a change to `CHECKOUT_HOLD_MINUTES` needs a restart, like every
 *  other env-driven constant in the tree. */
export const HOLD_MINUTES = resolveHoldMinutes();

/** The payment window (§2.8.1): the same number as the checkout-hold TTL, under the SPEC's name. */
export const PAYMENT_WINDOW_MINUTES = HOLD_MINUTES;

/**
 * `asOf` − the payment window, as ISO-8601 UTC. A pending row is live iff it was reserved
 * strictly after this instant. Computed once per read and handed to the adapters, so the
 * database does no clock arithmetic and the in-memory adapter agrees with it to the millisecond.
 */
export function pendingLiveSince(asOf: string): string {
  return new Date(Date.parse(asOf) - PAYMENT_WINDOW_MINUTES * 60_000).toISOString();
}

/**
 * Does this pending row still hold its boat? True for a `pending` row reserved after
 * `liveSince`, and for every admin-source pending row — those have no payment window and never
 * lapse (DEC-163). Everything else — booked, cancelled, lapsed — is false.
 *
 * Deliberately NOT a variant of `isBooked`: that predicate answers "is this a sale", this one
 * answers "is this boat committed", and a reader that wants one must not be handed the other.
 */
export function isLivePending(r: Reservation, liveSince: string): boolean {
  if (r.status !== "pending") return false;
  if (r.source === "admin") return true;
  return r.reservedAt !== undefined && Date.parse(r.reservedAt) > Date.parse(liveSince);
}
