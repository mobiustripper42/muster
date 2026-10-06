/**
 * Dollars an operator typed, to integer cents (DEC-112). Its own module (16.5) because the phone
 * booking's discount box re-totals in the browser and must parse exactly as the server does — and
 * `refund-payment.ts`, where this lived, imports `node:crypto`. Pure; nothing server-only.
 */

/**
 * Parse a dollars string an operator typed into integer cents (DEC-112), or `null`.
 *
 * **Validate the string, never the coercion** — the same rule the webhook's `requireCents`
 * exists for, and for a sharper reason here: this figure is chosen by a human under time
 * pressure and every permissive parse fails toward moving the WRONG amount of real money.
 * `Number("")` is 0, `parseFloat("50abc")` is 50, `Number("5e2")` is 500, `Number("0x10")` is
 * 16. None of those are things a person meant to type into a refund box.
 *
 * Accepts a leading `$` and thousands commas because operators paste from Stripe, and one or
 * two decimal places. Refuses three (`1.005` is not a refundable amount; silently rounding it
 * would pick a direction on the operator's behalf) and refuses a negative (a refund's direction
 * is the button, not the sign).
 *
 * Cents are assembled from the two halves as INTEGERS rather than by multiplying the parsed
 * float: `70.55 * 100` is `7054.999999999999`, and truncating that loses a cent on an ordinary
 * amount.
 */
export function parseDollarsToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/^\$/, "");
  // **Commas must be in thousands positions or the value is refused.** Stripping them
  // unconditionally turns a DECIMAL comma into a 100× refund: `"1,50"` → `"150"` → $150.00
  // against an intended $1.50, with the success message, the ledger and the compare-and-swap
  // all agreeing on the wrong number. `,` and `.` are adjacent kinds of typo, and a decimal
  // comma is what you get pasting from most of the world. The only backstop was
  // `exceeds_refundable`, which does nothing on a booking large enough to absorb it.
  //
  // So: either no commas at all, or `1,234,567` exactly. Anything else is refused rather
  // than interpreted, because there is no reading of `1,50` that is safe to guess at.
  const grouped = /^\d{1,3}(,\d{3})+$/;
  const [intPart = "", ...restParts] = trimmed.split(".");
  if (intPart.includes(",") && !grouped.test(intPart)) return null;
  if (restParts.some((p) => p.includes(","))) return null;
  const cleaned = trimmed.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const dollars = Number(m[1]);
  const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  if (!Number.isSafeInteger(dollars)) return null;
  return dollars * 100 + cents;
}
