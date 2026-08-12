/**
 * The operator-facing copy of a customer's manage link (#686) — and the gate that keeps it off
 * production.
 *
 * A pure function taking `isProd` rather than reading it, so the gate is testable. The e2e cannot
 * cover this one: `E2E_PROD` defaults to `!CI`, so the suite runs `next start` locally
 * (NODE_ENV=production ⇒ `isProdDeploy()` true, no link) and `next dev` in CI (link present). A
 * spec asserting either would pass in one place and fail in the other. Same constraint that made
 * `app/lib/time-clock-gate.test.ts` assert its wiring structurally instead.
 *
 * **Why the gate exists.** `reservationLinkToken` is a bare HMAC over the reservation id — no
 * expiry, no revocation, no rotation. Anyone holding the URL can open that booking forever. On a
 * dev box that is the point: there is otherwise no way to reach the manage page at all, short of
 * hand-running the HMAC in a `node -e` one-liner. On production it would put a live bearer token
 * on the operator's clipboard, one paste from a Slack thread — and unlike a leaked password there
 * is nothing to reset. Same posture as `/crew/dev-link` (DEC-057).
 *
 * The resend path carries no such exposure: it puts the token only where it already was, in the
 * customer's own inbox.
 */
import { reservationManageUrl } from "@core/reservations/booking-link.js";
import { asId } from "@core/domain/ids.js";

export interface ManageLinkInput {
  /** `isProdDeploy()` at the call site — passed, not read, so this stays pure. */
  isProd: boolean;
  /** The trusted public origin (APP_BASE_URL), already trimmed of trailing slashes. */
  base: string | undefined;
  /** RESERVATION_LINK_SECRET (DEC-122). */
  secret: string | undefined;
  reservationId: string;
}

/** The URL, or `undefined` when it must not or cannot be built. */
export function operatorManageLink(input: ManageLinkInput): string | undefined {
  if (input.isProd) return undefined;
  // No base or secret means no link — never a Host-header fallback, which is how a manage URL
  // would get minted against an attacker-supplied origin (see base-url.ts).
  if (!input.base || !input.secret) return undefined;
  return reservationManageUrl(input.base, asId<"ReservationId">(input.reservationId), input.secret);
}
