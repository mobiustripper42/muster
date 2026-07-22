/**
 * Customer identity (12.12b, DEC-132) — the ONE module that decides who a customer is.
 *
 * Two jobs, deliberately together: canonicalize a phone into the identity key, and mint the
 * readable `displayCode`. Everything that resolves a customer goes through here, which is what
 * makes the deferred **phone-or-email** decision cheap (DEC-132): when the Xola importer forces
 * it at cutover, the policy changes in this file rather than across every call site.
 *
 * **Deliberately NOT `normalizePhone` from `src/adapters/sms-deep-link.ts`.** That helper strips
 * non-digits for `sms:` URLs and is permissive by design — it happily returns a 3-digit string.
 * An identity key can't inherit those semantics: two different people must never canonicalize to
 * the same key, and a typo must fail loudly rather than silently key a customer. Same input
 * shape, different contract; keeping them apart is the point.
 */

/** A phone that passed canonicalization — E.164, the UNIQUE key on `customers`. */
export type CanonicalPhone = string;

/** Why a phone couldn't become an identity key. Surfaced to the booking form verbatim. */
export type PhoneRejection =
  | "empty"
  | "too_short"
  | "too_long"
  | "not_dialable"
  | "unsupported_country";

export type PhoneResult =
  | { ok: true; phone: CanonicalPhone }
  | { ok: false; reason: PhoneRejection };

/**
 * Canonicalize a raw phone to E.164, or say why not.
 *
 * NANP-only on purpose (BrewBoat is one dock in Ohio): 10 digits take `+1`; 11 digits leading `1`
 * are the same number written long; an explicit `+` passes through if it's a plausible E.164. A
 * non-`+` international number is REJECTED rather than guessed — silently prefixing `+1` onto a
 * foreign number would mint a wrong identity key, and a wrong key is worse than a refused booking.
 *
 * NANP structural rules are checked (area code and exchange both start 2-9) because they cheaply
 * catch the realistic typo — a dropped or doubled digit — that would otherwise become a customer.
 */
export function canonicalizePhone(raw: string | undefined | null): PhoneResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "not_dialable" };

  if (hasPlus) {
    // Explicit international intent — trust the caller's country code, sanity-check the length.
    if (digits.length < 8) return { ok: false, reason: "too_short" };
    if (digits.length > 15) return { ok: false, reason: "too_long" }; // E.164 hard ceiling
    return { ok: true, phone: `+${digits}` };
  }

  // Bare digits ⇒ NANP or nothing.
  const nanp = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (nanp.length < 10) return { ok: false, reason: "too_short" };
  if (nanp.length > 10) return { ok: false, reason: "unsupported_country" };
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(nanp)) return { ok: false, reason: "not_dialable" };
  return { ok: true, phone: `+1${nanp}` };
}

/** `true` when the raw input is usable as an identity key. Sugar over `canonicalizePhone`. */
export function isCanonicalizablePhone(raw: string | undefined | null): boolean {
  return canonicalizePhone(raw).ok;
}

/** Operator-facing copy for a rejected phone. One sentence, no jargon, says what to do. */
export function phoneRejectionMessage(reason: PhoneRejection): string {
  switch (reason) {
    case "empty":
      return "Enter a phone number — it's how we reach you about the trip.";
    case "too_short":
      return "That phone number is too short. Enter all 10 digits, area code first.";
    case "too_long":
      return "That phone number is too long. Enter all 10 digits, area code first.";
    case "unsupported_country":
      return "Enter a 10-digit US number, or write it with a country code (+44…).";
    case "not_dialable":
      return "That doesn't look like a working phone number. Check the digits and try again.";
  }
}

/** "+12165550148" → "(216) 555-0148". Falls back to the raw value for non-NANP numbers. */
export function formatPhoneForDisplay(phone: CanonicalPhone): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

// ── Display code (DEC-132) ────────────────────────────────────────────────────

/**
 * Crockford base32 — the standard alphabet minus I, L, O and U. I/L/O drop because they collide
 * with 1/1/0 when read aloud or handwritten; U drops so the encoding can't spell an obscenity.
 * 6 chars ⇒ 32^6 ≈ 1.07B codes, which at this operator's scale will never meaningfully collide.
 */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const DISPLAY_CODE_PREFIX = "C-";
export const DISPLAY_CODE_LENGTH = 6;

/** A well-formed display code, e.g. `C-K7X3P9`. Anchored — no partial matches. */
const DISPLAY_CODE_RE = new RegExp(`^${DISPLAY_CODE_PREFIX}[${CROCKFORD_ALPHABET}]{${DISPLAY_CODE_LENGTH}}$`);

/**
 * Mint a display code from injected randomness. `random` returns [0,1) — the caller passes
 * `Math.random` in the app and a stub in tests, keeping this module pure and the tests
 * deterministic (the codebase's clock-free/`createdAt`-injected idiom, same reason).
 *
 * Uniqueness is the DATABASE's job, not this function's: `customers.display_code` carries a
 * UNIQUE index and the caller retries on conflict (DEC-131 — structural invariants belong in
 * storage). Generating "probably unique" values in TS and trusting them is how duplicates ship.
 */
export function mintDisplayCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < DISPLAY_CODE_LENGTH; i++) {
    const idx = Math.floor(random() * CROCKFORD_ALPHABET.length);
    // Guard the [0,1) contract: a stub returning exactly 1 would index off the end.
    out += CROCKFORD_ALPHABET[Math.min(idx, CROCKFORD_ALPHABET.length - 1)];
  }
  return `${DISPLAY_CODE_PREFIX}${out}`;
}

export function isDisplayCode(value: string): boolean {
  return DISPLAY_CODE_RE.test(value);
}

/**
 * Normalize an operator-typed code for lookup: uppercase, add the prefix if they omitted it, and
 * fold the ambiguous characters the alphabet excludes (I/L → 1, O → 0) so a code read off a phone
 * call still resolves. Returns null if it can't become a valid code.
 */
export function parseDisplayCode(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/^C-?/, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/[^0-9A-Z]/g, "");
  const candidate = `${DISPLAY_CODE_PREFIX}${cleaned}`;
  return isDisplayCode(candidate) ? candidate : null;
}
