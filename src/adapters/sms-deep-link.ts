/**
 * `sms:` deep-link builder — support code for the web-link pilot channel
 * (DEC-030). Muster does not send SMS itself in the pilot (DEC-MSG-1 keeps
 * Twilio at the later adapter swap); the operator outbox surfaces `sms:` URIs as
 * per-ask Send buttons that open the operator's native Messages app with the
 * recipient and body pre-filled. RFC 5724 specifies `sms:NUMBER?body=...`; iOS
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
