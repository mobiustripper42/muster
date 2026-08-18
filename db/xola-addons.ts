/**
 * Xola add-on parsing — the wire shape behind the passenger report's `extra` and `declared`
 * columns, extracted from `xola-report.ts` so it can be tested (#757 note: `db/` had no test
 * surface, and this is the one piece of guessing-at-a-third-party-shape in the whole script).
 *
 * **The shape, learned from `--raw` on a real response, not from docs.** Xola renders *every
 * option* of a question as its own add-on row and marks the chosen one with `quantity >= 1`.
 * An unselected option is still present, at `quantity: 0`. So a customer who answered
 * "No-Good with 12" to a two-option question produces BOTH rows:
 *
 *     { quantity: 0, configuration: { name: "…adding more guests over 12?: Yes-one more" } }
 *     { quantity: 1, configuration: { name: "…adding more guests over 12?: No-Good with 12" } }
 *
 * Reading existence rather than quantity therefore reads back the answer they declined.
 */

/** Add-on rows are `{quantity, amount, configuration:{name}}`. Only the name identifies them. */
export interface XolaAddOn {
  quantity?: number;
  amount?: number;
  configuration?: { name?: string };
}

export const EXTRA_TICKETS = /^extra tickets/i;
export const MORE_GUESTS = /adding more guests over \d+\?:\s*(.+)$/i;
/** "Yes-two more" → 2. The checkout offers words, not digits. */
export const WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export interface AddOnReading {
  /** Extra tickets actually PAID for, summed by quantity. */
  extra: number;
  /** Every guest-question answer seen, verbatim — what the report prints as "two answers". */
  declared: string[];
  /** The largest guest count any answer declared, or null if nothing parsed. */
  declaredMax: number | null;
  /** True when the item carried no `addOns` key at all — a wire-shape change, not an empty cart. */
  missingAddOnsKey: boolean;
}

export function readAddOns(item: { addOns?: unknown }): AddOnReading {
  const missingAddOnsKey = !Array.isArray(item.addOns);
  const addOns = (item.addOns ?? []) as XolaAddOn[];
  let extra = 0;
  const declared: string[] = [];
  let declaredMax: number | null = null;

  // **A guest answer is only overridden by an explicitly SELECTED answer to the same question —
  // never by the absence of payment.** Two real cases forced this shape, and the naive rule
  // ("skip quantity 0") gets the second one dangerously wrong:
  //
  //   Mallory — "Yes-one more" at qty 0 AND "No-Good with 12" at qty 1. She chose No; the Yes row
  //     is an option she declined, still on the wire. Reading existence flagged her WOULD BE OVER
  //     on a boat she had said she was not adding to.
  //   Sarah   — declared 4, paid 0, and NO selected answer to fall back on. Dropping her unpaid
  //     row silenced a real over-capacity warning (16 > 14). Unpaid is the whole point of the
  //     DECLARED ≠ PAID section: "didn't pay" is not "didn't say".
  //
  // So: if any answer was selected, the selected ones are the answer. If none was, every answer
  // counts. That can only ever ADD an alert back, which is the safe direction for a
  // Certificate-of-Inspection limit.
  const answers = addOns
    .map((a) => ({ a, m: MORE_GUESTS.exec((a.configuration?.name ?? "").trim()) }))
    .filter((x): x is { a: XolaAddOn; m: RegExpExecArray } => x.m !== null);
  const selected = answers.filter(
    (x) => typeof x.a.quantity !== "number" || x.a.quantity >= 1,
  );
  const answering = selected.length > 0 ? selected : answers;

  for (const a of addOns) {
    const name = (a.configuration?.name ?? "").trim();
    if (EXTRA_TICKETS.test(name)) {
      extra += typeof a.quantity === "number" ? a.quantity : 0;
    }
  }

  for (const { m } of answering) {
    const answer = (m[1] ?? "").trim();
    declared.push(answer);
    // "No-Good with 12" ⇒ 0; "Yes-two more" ⇒ 2. An unrecognised phrasing is left null rather
    // than coerced to 0 — reporting "declared 0" for a sentence nobody parsed would invent a
    // clean answer out of an unknown one.
    if (/^no\b/i.test(answer)) declaredMax = Math.max(declaredMax ?? 0, 0);
    else {
      const w = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(answer);
      const n = w ? WORD[w[1]!.toLowerCase()] : Number((/\b(\d+)\b/.exec(answer) ?? [])[1]);
      if (typeof n === "number" && Number.isFinite(n)) declaredMax = Math.max(declaredMax ?? 0, n);
    }
  }
  return { extra, declared, declaredMax, missingAddOnsKey };
}
