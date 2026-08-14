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
 * **Why the gate still exists after #741.** The link is now `/b/<code>` against a stored, and
 * therefore revocable, credential — which is exactly the change the original gate said would
 * justify revisiting it. Revisiting it is deliberately NOT in #741's scope: a revocable token on
 * the operator's clipboard is still a live token in a Slack thread, and the remedy (notice it,
 * reissue) depends on someone realising it leaked. Same posture as `/crew/dev-link` (DEC-057)
 * until that's a decision someone makes on purpose.
 *
 * The resend path carries no such exposure: it puts the code only where it already was, in the
 * customer's own inbox.
 */
import { bookingUrl } from "@core/reservations/booking-code.js";

export interface ManageLinkInput {
  /** `isProdDeploy()` at the call site — passed, not read, so this stays pure. */
  isProd: boolean;
  /** The trusted public origin (APP_BASE_URL), already trimmed of trailing slashes. */
  base: string | undefined;
  /** The booking's LIVE code (#741), read at the call site. Absent ⇒ no link to show: an
   *  imported booking, or one whose code was revoked and not yet reissued. */
  code: string | undefined;
}

/** The URL, or `undefined` when it must not or cannot be built. */
export function operatorManageLink(input: ManageLinkInput): string | undefined {
  if (input.isProd) return undefined;
  // No base or no live code means no link — never a Host-header fallback, which is how a manage
  // URL would get minted against an attacker-supplied origin (see base-url.ts).
  if (!input.base || !input.code) return undefined;
  return bookingUrl(input.base, input.code);
}
