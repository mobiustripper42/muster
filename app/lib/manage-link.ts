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
 * **The gate is CONDITIONAL as of 2026-08-15 (operator), not absolute.** Off production the link
 * always renders. On production it renders **only in the moment after a reissue**
 * (`justReissued`), and is put away again on the next load.
 *
 * The reasoning, because loosening a security gate deserves one written down:
 *
 *  - The original gate guarded an **unrevocable** HMAC. A leak could only be undone by rotating
 *    the secret, dead-linking every customer at once. #741 replaced it with a stored code that
 *    dies on demand — which the gate's own comment named as the condition for revisiting it.
 *  - **A reissue has already killed the customer's previous link** by the time this renders, so
 *    the revealed code is one the operator minted deliberately, one action ago. Nothing is
 *    exposed that outlived the decision to expose it.
 *  - The code is 14 Crockford base32 characters — an alphabet chosen so it can be **read aloud**.
 *    The 129-character HMAC could not be, which is why nobody ever asked to see it. The realistic
 *    support call (customer at the dock, no link, operator on the phone) now has an answer that
 *    doesn't depend on email or SMS working at all.
 *  - It removes the one genuinely stranding outcome: a reissue whose send failed used to leave
 *    the operator holding a notice saying the customer has no working link, and no way to give
 *    them one.
 *
 * What is deliberately NOT restored: a link sitting on screen for every booking anyone opens.
 * That is the exposure worth caring about — a screenshot, a shared screen, a tab left open on a
 * pane — and it is the one this keeps closed.
 *
 * The resend path carries no such exposure either way: it puts the code only where it already
 * was, in the customer's own inbox.
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
  /**
   * True only on the render that immediately follows a reissue on THIS booking — derived from
   * the post-action redirect's params, so it does not survive a reload.
   *
   * Deliberately a flag rather than the code itself: passing the credential through the redirect
   * would put it in the URL bar, browser history, and any access log that records query strings.
   * The pane re-reads the live code server-side instead.
   */
  justReissued?: boolean;
}

/** The URL, or `undefined` when it must not or cannot be built. */
export function operatorManageLink(input: ManageLinkInput): string | undefined {
  if (input.isProd && !input.justReissued) return undefined;
  // No base or no live code means no link — never a Host-header fallback, which is how a manage
  // URL would get minted against an attacker-supplied origin (see base-url.ts).
  if (!input.base || !input.code) return undefined;
  return bookingUrl(input.base, input.code);
}
