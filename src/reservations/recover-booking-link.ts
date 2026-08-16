/**
 * "Lost your link?" — the public recovery request (12.7, issue #460).
 *
 * Composes the three pieces: claim the throttle, match a booking, send the link to the contact
 * **on file**. The one thing this module exists to guarantee is that the caller cannot tell those
 * paths apart.
 *
 * **One outcome, deliberately.** `recoverBookingLink` returns `void`. Not a boolean, not a
 * "found/not found" — nothing a caller could accidentally render. A form that says "no booking
 * with that email" is an oracle for who has booked, and a form whose timing or redirect differs
 * is the same oracle wearing a hat. `src/auth/login-code.ts` made this exact choice for the same
 * reason and wrote it down: *"there is deliberately one value."*
 *
 * **The link goes to the stored contact, never the typed one.** They are equal on an exact match
 * today, which is what makes this cheap — but writing it as "the row's contact" is what stops a
 * future fuzzy match from quietly becoming a disclosure bug.
 *
 * **Errors are swallowed.** A repo outage or a dead channel must not surface, because "something
 * went wrong" is itself a signal that differs from the silent no-match path. Failures go to
 * `onFailure` for the operator's logs.
 *
 * **The caller must run this OFF the response path** (`after()` — see `app/b/find/actions.ts`).
 * An identical response body is only half of no-enumeration: awaiting a real network send that
 * fires only on a match makes a match observably *slower* than a miss, which is the same oracle
 * measured with a stopwatch instead of read off the page. This codebase already learned that on
 * the login path — `app/lib/auth-delivery.ts` and `src/auth/login-code.ts` both record it — and
 * this module was written without applying it until review caught the omission.
 */

import type { ChannelPort } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { contactKey } from "../customers/identity.js";
import { ensureBookingCode } from "./ensure-booking-code.js";
import { matchBookingForRecovery, type RecoveryQuery, type RecoveryRow } from "./find-booking.js";
import { resendBookingLink } from "./resend-booking-link.js";

/**
 * How long one contact must wait between recovery requests.
 *
 * Short on purpose. The throttle is claimed before matching, on every request, so it also bounds
 * the no-match path — which means a stranger can burn a real customer's window. DEC-142 accepted
 * that same trade for login codes; keeping the window in minutes is what keeps the cost of it to
 * "try again shortly" rather than "you cannot recover your booking today".
 */
export const RECOVERY_COOLDOWN_MS = 15 * 60 * 1000;

export interface RecoverDeps {
  repo: Repository;
  email?: ChannelPort;
  sms?: ChannelPort;
  /** Trusted public origin (APP_BASE_URL at the edge) — never a Host header. */
  linkBase: string;
  /** ISO-8601 UTC now. */
  now: () => string;
  /** Vessel-local day (DEC-032) — decides which trip counts as upcoming. */
  today: string;
  /** Durable observer for a failure nobody on the form is allowed to see. */
  onFailure?: (detail: string) => void;
}

/**
 * Process one recovery request. Always resolves, always identically.
 *
 * **`loadRows` is a THUNK, not an array, and that is load-bearing.** The reservation+event scan
 * is the expensive part of this request, and it must happen *after* the throttle claim or the
 * throttle bounds only the sends and not the work — one request per second with a fresh contact
 * would force a full-table read every time, for free. Taking rows eagerly made the file's own
 * comment ("bounded ahead of it by the throttle") false; taking a thunk makes it true.
 */
export async function recoverBookingLink(
  deps: RecoverDeps,
  loadRows: () => Promise<readonly RecoveryRow[]>,
  query: RecoveryQuery,
): Promise<void> {
  try {
    const key = contactKey(query.contact);
    // Unusable contact ⇒ nothing to throttle and nothing to match. Returning here costs an
    // attacker nothing they didn't already know (they typed the junk), and it keeps garbage out
    // of the throttle table.
    if (!key) return;

    const nowIso = deps.now();
    const claim = await deps.repo.claimRecoverySend(
      key,
      nowIso,
      new Date(Date.parse(nowIso) + RECOVERY_COOLDOWN_MS).toISOString(),
    );
    // Claimed BEFORE matching, so the no-match path is bounded too — that is the path an abuser
    // uses, and it is free to run otherwise.
    if (!claim.claimed) return;

    // Only now — past the claim — is it worth reading the world.
    const match = matchBookingForRecovery(await loadRows(), query, deps.today);
    if (!match) return;

    // Mints one if this booking never had a code — an imported or pre-#741 booking is exactly
    // the case where the customer has nothing and is asking for it.
    const code = await ensureBookingCode(deps.repo, match.reservation.id, deps.now);

    await resendBookingLink(
      {
        linkBase: deps.linkBase,
        ...(deps.email ? { email: deps.email } : {}),
        ...(deps.sms ? { sms: deps.sms } : {}),
        ...(deps.onFailure ? { onFailure: deps.onFailure } : {}),
      },
      match.reservation,
      code,
    );
  } catch (e) {
    // Never rethrow: a thrown error renders differently from a silent success, which hands back
    // exactly the signal this module exists to withhold.
    deps.onFailure?.(`booking-link recovery failed — ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Re-exported so this module's callers and tests keep one import. The implementation moved to
 * `customers/identity.ts` at #575, when the checkout-hold reuse needed the same key — two
 * spellings of "which buyer is this" is how one person becomes two.
 */
export { contactKey };
