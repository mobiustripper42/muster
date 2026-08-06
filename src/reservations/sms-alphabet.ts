/**
 * GSM-7 alphabet check for outbound SMS bodies (#619, #685).
 *
 * A single character outside GSM 03.38 re-encodes the ENTIRE message as UCS-2 — 67 characters
 * per concatenated segment instead of 153 — better than doubling the cost of every send. The
 * failure is invisible: the text still arrives, it just costs more, on every message, forever.
 * The booking confirmation's `— Muster` sign-off did this until #619; the sold-out notice's did
 * until #685. Neither was noticed by a human reading the copy, which is why it is a test.
 *
 * Test-only helper — nothing in the delivery path calls it. It exists so a body's alphabet is
 * asserted rather than eyeballed. NOT a sanitizer: it reports strays, it does not rewrite copy.
 * An interpolated customer name can legitimately force UCS-2 and is not ours to control — pass
 * `ignore` to exclude the interpolated values a body doesn't own.
 */

/** GSM 03.38 basic set — the 127 default-alphabet characters (the ESC shift is excluded). */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** Extension table — still GSM-7, but two septets each. */
const GSM7_EXTENSION = "^{}\\[~]|€";

const GSM7 = new Set([...GSM7_BASIC, ...GSM7_EXTENSION]);

/**
 * Every character in `body` that would force the message out of GSM-7, in order of appearance
 * and de-duplicated. Empty ⇒ the body encodes as GSM-7.
 *
 * The usual offenders are the ones a word processor or a careful writer reaches for: em and en
 * dashes, curly quotes, the ellipsis character, and bullets.
 */
export function nonGsm7Chars(body: string, ignore: readonly string[] = []): string[] {
  let text = body;
  for (const value of ignore) {
    if (value) text = text.split(value).join("");
  }
  return [...new Set([...text].filter((c) => !GSM7.has(c)))];
}
