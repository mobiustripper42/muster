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
 */

import type { ChannelPort } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { canonicalizePhone } from "../customers/identity.js";
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
 * `rows` is the reservation+event set to search — read by the caller so this stays a composer
 * rather than a second place that knows how to join those two.
 */
export async function recoverBookingLink(
  deps: RecoverDeps,
  rows: readonly RecoveryRow[],
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

    const match = matchBookingForRecovery(rows, query, deps.today);
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
 * The throttle bucket for a typed contact, or null if it can't be one.
 *
 * Canonicalized so `216-555-0148`, `(216) 555-0148` and `+12165550148` share one bucket instead
 * of being three free attempts — the bound is on the person, not on the spelling.
 */
export function contactKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const phone = canonicalizePhone(trimmed);
  return phone.ok ? phone.phone : null;
}
