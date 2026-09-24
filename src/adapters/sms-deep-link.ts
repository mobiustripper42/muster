/**
 * `sms:` deep-link builder — a link that opens the native Messages app with the
 * recipient and body pre-filled (used for texting a guest from the crew card,
 * `src/customers/identity.ts`). It was written for the operator outbox (DEC-030),
 * gone since #934. RFC 5724 specifies `sms:NUMBER?body=...`; iOS
 * 8+ and Android Chrome both honor this form.
 *
 * Ported from Bushel's send-queue (same operator-relay pattern), pinned
 * behaviors and all — see the unit tests.
 */

export type SmsTarget = {
  phone: string;
  body: string;
};

// Builder is never-throw and always emits `?body=` (even for empty bodies) so
// callers get a single stable shape. Caller is responsible for validating that
// `phone` is non-empty and dialable — an empty phone produces `sms:?body=...`,
// which the OS will reject silently. Extension syntax (`555-1234 x123`) is not
// detected; non-digit chars are stripped wholesale, so extension digits glue
// onto the main number. See the pinned-behavior tests.
export function buildSmsUrl({ phone, body }: SmsTarget): string {
  return `sms:${normalizePhone(phone)}?body=${encodeURIComponent(body)}`;
}

export function normalizePhone(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasLeadingPlus ? `+${digits}` : digits;
}
