/**
 * Get-or-mint a booking's manage code (#741, DEC-154) — the seam every path that needs a
 * customer link goes through: the confirmation emit, the operator resend, the operator's copy
 * affordance, and the dev seeds.
 *
 * Mirrors `customers/resolve.ts`: a pure minter (`booking-code.ts`) plus this repo-touching
 * get-or-create with a bounded retry, so the collision is settled by the database rather than by
 * a read-then-write in the caller.
 *
 * **Idempotent on purpose.** A Stripe redelivery, a second resend, and an operator opening the
 * pane twice must not each mint a code — a booking with five live credentials is five things to
 * revoke and four the customer never asked for. The FIRST live code wins and is returned
 * forever; only an explicit reissue makes a new one.
 *
 * **Never throws at the confirmation call site's peril.** By the time this runs the customer has
 * PAID. A mint failure must not 500 the Stripe webhook, so the caller there treats "no code" as
 * "no link to send" and reports it — the same posture as `resolveCustomerId`, for the same
 * reason: the unlinked row is recoverable later, the booking is not.
 */

import type { Buffer } from "node:buffer";
import type { BookingCode } from "../domain/entities.js";
import type { ReservationId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { bookingCodeRefusal, mintBookingCode } from "./booking-code.js";

/** How many codes to try before giving up. A collision is ~1-in-2^70 per mint; three attempts
 *  makes a real one a non-event and an infinite loop impossible (the `resolve.ts` shape). */
const CODE_MINT_ATTEMPTS = 3;

/** The live code for a reservation, or undefined. Live = neither revoked nor expired. */
export async function liveBookingCode(
  repo: Repository,
  reservationId: ReservationId,
  now: () => string,
): Promise<string | undefined> {
  const rows = await repo.listBookingCodesForReservation(reservationId);
  const nowIso = now();
  return rows.find((r) => bookingCodeRefusal(r, nowIso) === null)?.code;
}

/**
 * The live code for a reservation, minting one if there isn't one. `now` and `bytes` are
 * injected (house style: clock-free, deterministic under test).
 *
 * Mints for an OLD booking too — a Xola-imported reservation has never had a code, and the
 * operator resending its link is exactly when it should get one.
 */
export async function ensureBookingCode(
  repo: Repository,
  reservationId: ReservationId,
  now: () => string,
  bytes?: (n: number) => Buffer,
): Promise<string> {
  const existing = await liveBookingCode(repo, reservationId, now);
  if (existing) return existing;

  let lastError: unknown;
  for (let attempt = 0; attempt < CODE_MINT_ATTEMPTS; attempt++) {
    const code = bytes ? mintBookingCode(bytes) : mintBookingCode();
    const row: BookingCode = { code, reservationId, createdAt: now() };
    try {
      await repo.saveBookingCode(row);
      return code;
    } catch (e) {
      // A PK collision is the only retryable failure. Anything else (pool dropped, FK violation
      // because the reservation isn't written yet) rethrows immediately rather than burning the
      // budget and reporting the last of three identical errors.
      if (!isDuplicateCode(e)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * What a reissue actually achieved.
 *
 * `staleCodes` is non-empty only when the new code was minted but one or more old ones could not
 * be revoked — the mixed state. It exists because the alternative is a caller that says "their
 * old link is dead" without knowing whether it is, which is the one sentence an operator acts on.
 */
export interface ReissueResult {
  code: string;
  /** Old codes still live despite the reissue. Empty on the normal path. */
  staleCodes: string[];
}

/**
 * Mint a NEW code and kill every previous one for the booking.
 *
 * **Revoking the predecessors is the point, not a side effect.** A reissue is what an operator
 * reaches for when a link leaked or a customer lost the phone it was on; leaving the old code
 * live would make the act cosmetic. The cost is real and accepted (DEC-154): a customer who kept
 * the original text and never asked for anything lands on the "this link was replaced" state,
 * which is why that state has to tell them how to get a new one rather than just refusing.
 *
 * Order matters — mint FIRST, revoke second. The reverse leaves a booking with no live code at
 * all if the mint then fails, and the customer's existing link is the only one they have.
 */
export async function reissueBookingCode(
  repo: Repository,
  reservationId: ReservationId,
  now: () => string,
  bytes?: (n: number) => Buffer,
): Promise<ReissueResult> {
  const priors = await repo.listBookingCodesForReservation(reservationId);

  let lastError: unknown;
  for (let attempt = 0; attempt < CODE_MINT_ATTEMPTS; attempt++) {
    const code = bytes ? mintBookingCode(bytes) : mintBookingCode();
    const row: BookingCode = { code, reservationId, createdAt: now() };
    try {
      await repo.saveBookingCode(row);
    } catch (e) {
      if (!isDuplicateCode(e)) throw e;
      lastError = e;
      continue;
    }

    // Past the mint, so a NEW code exists and throwing would lose it. A revoke that fails is
    // reported, not raised: the caller has to tell the operator something true, and "the reissue
    // failed" is false once a live replacement is in the table. `staleCodes` is the honest
    // remainder — old links that are still open despite the operator asking for them to be shut.
    const staleCodes: string[] = [];
    for (const prior of priors) {
      if (prior.revokedAt) continue;
      try {
        await repo.revokeBookingCode(prior.code, now());
      } catch {
        staleCodes.push(prior.code);
      }
    }
    return { code, staleCodes };
  }
  throw lastError;
}

/** Both adapters raise a Postgres-shaped duplicate-key error; the in-memory double copies the
 *  message deliberately so this predicate is one thing, not two. */
function isDuplicateCode(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return msg.includes("booking_codes_pkey") || msg.includes("duplicate key");
}
