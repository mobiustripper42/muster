/**
 * The operator's contact phone (issue #1159, `docs/SPEC.md §2.8.4`).
 *
 * The number a customer is given where the site tells them to call. It lives in `app_settings`
 * under {@link CONTACT_PHONE_KEY}; an absent or blank row means "no number yet", and every sentence
 * here then keeps saying plain "call us". The row is hand-written, so {@link parseContactPhone}
 * canonicalizes whatever spelling it finds and refuses what it cannot, rather than show a customer
 * a bad number.
 *
 * No screen edits it yet. It is set by SQL until the settings page (issue #1166) ships.
 *
 * The sentences are here as strings because the cutoff refusal reaches the checkout form as a
 * string; `components/checkout/at-contact-phone.tsx` is their twin with the number as a link, and a
 * test holds the two to the same words.
 */
import { canonicalizePhone, formatPhoneForDisplay, type CanonicalPhone } from "../customers/identity.js";
import { logSwallowed } from "../log.js";
import type { Repository } from "../ports/repository.js";

/** The `app_settings` key. */
export const CONTACT_PHONE_KEY = "booking.contact_phone";

/**
 * Parse the stored value. Absent or blank ⇒ `null`, silently. A number `canonicalizePhone` accepts
 * ⇒ its canonical form, in whatever spelling it was typed. Anything else ⇒ `null` **and a log
 * line**: a typo in a hand-written SQL row must not show a customer a bad number, and must not go
 * unnoticed either, because the operator believes a number is being given out.
 */
export function parseContactPhone(raw: string | null | undefined): CanonicalPhone | null {
  const result = canonicalizePhone(raw);
  if (result.ok) return result.phone;
  if (result.reason === "empty") return null;
  logSwallowed(
    "reservations:contact-phone",
    new Error(`${CONTACT_PHONE_KEY} is ${JSON.stringify(raw)}, which is not a phone number (${result.reason})`),
    "the site tells customers to call without giving a number",
  );
  return null;
}

/**
 * What the pages call. **Never throws:** it sits on `/b/find`'s confirmation, a page that must not
 * fail and must not vary by whether anything matched, and a repository outage here costs a
 * customer one number, not the page.
 */
export async function readContactPhone(
  repo: Pick<Repository, "getContactPhone">,
): Promise<CanonicalPhone | null> {
  try {
    return await repo.getContactPhone();
  } catch (e) {
    logSwallowed(
      "reservations:contact-phone",
      e,
      "the site tells customers to call without giving a number",
    );
    return null;
  }
}

/** `" at (216) 555-0100"`, or `""`. The one home of those words as a string. */
export function atContactPhone(phone: CanonicalPhone | null): string {
  return phone === null ? "" : ` at ${formatPhoneForDisplay(phone)}`;
}

/** `Call us at (216) 555-0100 and we’ll book it for you`, or `Call us and we’ll book it for you`. */
export function callUsToBook(phone: CanonicalPhone | null): string {
  return `Call us${atContactPhone(phone)} and we’ll book it for you`;
}

/**
 * The checkout form's refusal when the departure has fallen inside the booking cutoff. It lives
 * here and not in `app/(public)/book/checkout/actions.ts` because every export of that
 * `"use server"` file is a public endpoint.
 */
export function cutoffRefusalMessage(phone: CanonicalPhone | null): string {
  return `That departure is now too close to book online. ${callUsToBook(phone)} — you have not been charged.`;
}
