/**
 * Resolve a booking's customer (12.12b, DEC-132) — the get-or-create that runs at booking time.
 *
 * Without this, the entity is stillborn: the backfill would link history once and every new
 * booking would immediately recreate the unlinked state, leaving `customers` a museum of last
 * month's data. This is the seam that keeps it live.
 *
 * **A booking is never lost to a phone problem.** By the time this runs the customer has PAID —
 * the webhook is materializing a reservation for money already captured. So an uncanonicalizable
 * phone yields `undefined` (the reservation is written unlinked) rather than throwing. Phone is
 * *required at the form* (`/book`), which is where a human can still fix it; enforcing it again
 * down here would only convert a bad phone into a lost paid booking. The unlinked row is
 * recoverable later; the booking is not.
 */

import type { Customer } from "../domain/entities.js";
import { asId, type CustomerId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { canonicalizePhone, mintDisplayCode } from "./identity.js";

export interface CustomerResolutionInput {
  customerName: string;
  phone?: string | undefined;
  email?: string | undefined;
}

/** How many display codes to try before giving up. Collisions are ~1-in-a-billion per mint;
 *  three attempts makes a real collision a non-event and an infinite loop impossible. */
const CODE_MINT_ATTEMPTS = 3;

/** Deterministic customer id from the canonical phone — stable, and it makes a retried booking
 *  resolve to the same candidate row rather than minting a fresh id each attempt. The DATABASE
 *  still arbitrates existence via the UNIQUE phone index; this only shapes the candidate. */
export function customerIdForPhone(phoneE164: string): CustomerId {
  return asId<"CustomerId">(`cust-${phoneE164.replace(/\D/g, "")}`);
}

/**
 * Get-or-create the customer for a booking, returning the id to stamp on the reservation.
 * `undefined` means "leave this reservation unlinked" — an absent or unusable phone.
 *
 * `now` and `random` are injected (house style: clock-free, deterministic under test).
 */
export async function resolveCustomerId(
  repo: Repository,
  input: CustomerResolutionInput,
  now: () => string,
  random: () => number = Math.random,
): Promise<CustomerId | undefined> {
  const canonical = canonicalizePhone(input.phone);
  if (!canonical.ok) return undefined;

  const phoneE164 = canonical.phone;

  // Fast path: the phone is already known. Skips minting a code we'd throw away, and is the
  // common case for a repeat customer.
  const existing = await repo.getCustomerByPhone(phoneE164);
  if (existing) return existing.id;

  let lastError: unknown;
  for (let attempt = 0; attempt < CODE_MINT_ATTEMPTS; attempt++) {
    const candidate: Customer = {
      id: customerIdForPhone(phoneE164),
      displayCode: mintDisplayCode(random),
      name: input.customerName,
      phoneE164,
      ...(input.email !== undefined ? { email: input.email } : {}),
      createdAt: now(),
      active: true,
    };
    try {
      const { customer } = await repo.getOrCreateCustomerByPhone(candidate);
      return customer.id;
    } catch (e) {
      // ONLY a display-code collision is retryable — the phone conflict resolves internally.
      // Anything else (connection dropped, constraint we didn't anticipate) rethrows at once
      // rather than burning the budget and reporting the last of three identical failures.
      if (!(e instanceof Error && e.message.includes("display_code"))) throw e;
      lastError = e;
    }
  }
  throw lastError;
}
