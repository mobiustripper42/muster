/**
 * Elapsed minutes → the strings a human or a payroll company reads. **One rounding rule, one
 * place** (#758).
 *
 * §2.9.6 forbids a rounding policy on *stored* data and none is applied there — punches keep
 * their milliseconds from `clockIn` all the way to here. But every surface has to pick a unit, so
 * precision is lost exactly ONCE, at the edge, and this module is that edge.
 *
 * **It rounds. It used to truncate, and that was wrong for this direction.** The original call
 * reasoned that "under-stating beats inflating when the number becomes a payment" — correct for a
 * number you *charge* a customer, and backwards for a number you *owe* an employee. Truncation is
 * one-directional by construction: every row lost up to 0.6 of a minute, always against the crew
 * member, never for them. Rounding is unbiased and halves the worst case. 29 CFR 785.48(b)
 * tolerates rounding precisely because it is expected to average out; a policy that can only move
 * one way is the shape that draws attention.
 *
 * **Why three exports and not one.** The rounding rule is shared; the *presentation* genuinely is
 * not. `hoursLabel` always carries both units so a table column lines up ("0h 0m"), `compactDuration`
 * drops the one that would read as zero ("8h", "45m"), and `decimalHours` speaks Gusto's unit. Both
 * e2e suites assert those literal shapes. Unifying the strings would be a different change, and a
 * worse one — what had to stop diverging is the arithmetic, and that now happens in `splitMinutes`
 * and nowhere else.
 *
 * All three take NON-NEGATIVE minutes. Callers wanting a signed delta take the absolute value and
 * add their own sign (see `deltaLabel` in the payroll page) — that keeps the sign in the surface
 * that knows what it means, rather than here.
 */

/** The single rounding step. Everything below formats what this returns; nothing rounds twice. */
function splitMinutes(minutes: number): { h: number; m: number } {
  const whole = Math.round(minutes);
  return { h: Math.floor(whole / 60), m: whole % 60 };
}

/**
 * Minutes → decimal hours, rounded to 2dp, as Gusto's `regular_hours` column wants it.
 *
 * **The arithmetic order is load-bearing, and the obvious spelling is wrong.** `(minutes / 60) * 100`
 * looks equivalent and is not: for 69 minutes — exactly 1.15 hours — it yields 114.99999999999999.
 * Under the old `Math.floor` that emitted "1.14", a whole extra cent below even the intended
 * truncation, in the column the payroll company pays from. Multiplying into hundredths first keeps
 * every exact boundary exact. Rounding has no cliff there either way, but the order stays and the
 * 69-minute case stays pinned in the tests.
 *
 * The string is built from the integer hundredths rather than `(h / 100).toFixed(2)`, so no float
 * touches the output path. That is legibility, not correctness — the two are equivalent across
 * this range, and the round-trip through a double just made the one function carrying a payroll
 * rule harder to read than it needed to be.
 *
 * Whether 2dp is right at all is the receiving company's answer, not ours — see #628's note about
 * confirming the format before the first real send.
 */
export function decimalHours(minutes: number): string {
  const hundredths = Math.round((minutes * 100) / 60);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** "0h 0m", "4h 50m" — both units always, so a column of them aligns. The payroll table. */
export function hoursLabel(minutes: number): string {
  const { h, m } = splitMinutes(minutes);
  return `${h}h ${m}m`;
}

/** "45m", "8h", "9h 30m" — drops the unit that would read as zero. The punch lists. */
export function compactDuration(minutes: number): string {
  const { h, m } = splitMinutes(minutes);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
