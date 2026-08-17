---
id: DEC-157
title: "Hours round at the edge rather than truncate, through one shared rule (#758)"
topic: "Crew, vessels & manning model"
amends_spec:
  - section: "2.9"
    scope: "§2.9.6 only — the direction precision is lost at the edge; the no-rounding-on-stored-data rule is unchanged"
---

## DEC-157: Hours round at the edge rather than truncate, through one shared rule (#758)

**Decision:** every minutes→hours conversion **rounds to the nearest unit**, and there is exactly one implementation of that rule — `src/admin/hours-format.ts`, exporting `decimalHours` (Gusto's 2dp), `hoursLabel` (the payroll table's aligned `Xh Ym`) and `compactDuration` (the punch lists' `8h` / `45m` / `9h 30m`). All three format the output of a single `Math.round`. Stored data is untouched: punches keep their milliseconds, and §2.9.6's ban on a rounding *policy* over stored hours stands.

**The old reasoning was right for the wrong direction.** §2.9.6 justified truncation as "under-stating beats inflating when the number becomes a payment." That is correct for a number Muster *charges* a customer — never overbill — and backwards for a number it *owes* an employee. The crew surface, where the call was first made (#626), is a display, and a display that under-promises against actual pay is defensible. The Gusto CSV is not a display; it **is** the payment. The policy was copied across a boundary at which its own logic inverts.

**Truncation is one-directional by construction.** Every row lost up to 0.6 of a minute in the file and up to 59.999 seconds on screen, always downward, never up. On the Aug 3–16 2026 period the CSV summed to 220.60 hours against the reconcile page's 220h 41m — about five minutes across seventeen people, every minute of it against the crew. Rounding is unbiased and halves the worst case. The dollars are small; the shape is what changes. 29 CFR 785.48(b) tolerates rounding precisely *because* it is expected to average out over time, and a policy that can only ever move one way is the pattern that draws attention in a wage-hour review. It cost one line not to have it.

**The displays round too, because the alternative is two numbers.** Punches are stamped to the millisecond at the tap (`src/crew/time-clock.ts`), so a crew-punched shift is essentially never a whole number of minutes and the screen was discarding seconds on nearly every row. Admin hand-entry arrives from `<input type="time">` and is minute-aligned, so those rows — the "office-edited" ones — read identically either way. Once the file rounds, a floored display is no longer conservative, it is simply a *different* number from the one being paid, drifting in a direction nobody can reconcile. The person most likely to add up their own rows and compare them to a paycheck is the crew member.

**One rule, three presentations — and the strings deliberately did not merge.** `0h 0m` keeps a table column aligned; `45m` does not. Both shapes are asserted literally in e2e (`payroll-reconcile.spec.ts`, `admin-time-clock.spec.ts`). What had to stop diverging was the arithmetic, not the formatting, and unifying the strings would have been a different change that broke a working surface.

**Why a shared module and not four fixes.** The rule was spelled four times in three shapes — `decimalHours`, `fmtMinutes` byte-identically in two page components, and `hoursLabel` — and one had drifted to a different policy. Every copy was correct on the day it was written, which is the whole difficulty: no per-PR review can see this, because the defect exists only across the corpus at a moment when nobody is editing any copy. While the rule lived in three private page-local functions with no exports and no tests, "every surface agrees" was not a claim anyone could check. It is now `hours-format.test.ts`.

**What this does not decide.** Whether 2dp is the right precision for Gusto at all remains open (#628) — that is the receiving company's answer. The `|Δ| < 1` "even" threshold on the payroll delta column is untouched. And the class of defect that produced this — one rule, many spellings — is parked in `docs/FUTURE_IDEAS.md` as a repo-wide audit, with the lint rules that catch its cheaper half filed as issue #757.

**See also** — DEC-090 (#250), which established the ESLint config this repo has; issue #757 extends it to `src/`, which was never linted at all.
