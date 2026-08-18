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
/** Group 1 = the threshold the question was calibrated to; group 2 = the customer's answer. */
export const MORE_GUESTS = /adding more guests over (\d+)\?:\s*(.+)$/i;
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
  /**
   * The hull size the guest question was calibrated to — the `12` in "adding more guests over
   * 12?". Null when the question was not asked.
   *
   * This is the ONLY record of which size boat the customer was answering *about*. Compared
   * against the boat they were actually assigned, it catches an upgraded hull: Sarah McCarty
   * answered "over 12?" and sailed on a 14-pax boat, so somebody moved her up and the extra
   * guests were never charged. Read off the question, NOT the chosen answer — the mismatch is a
   * property of what was asked, so an unselected option carries it just as well.
   */
  threshold: number | null;
  /** True when the item carried no `addOns` key at all — a wire-shape change, not an empty cart. */
  missingAddOnsKey: boolean;
}

export function readAddOns(item: { addOns?: unknown }): AddOnReading {
  const missingAddOnsKey = !Array.isArray(item.addOns);
  const addOns = (item.addOns ?? []) as XolaAddOn[];
  let extra = 0;
  const declared: string[] = [];
  let declaredMax: number | null = null;
  let threshold: number | null = null;
  for (const a of addOns) {
    const name = (a.configuration?.name ?? "").trim();
    if (EXTRA_TICKETS.test(name)) {
      extra += typeof a.quantity === "number" ? a.quantity : 0;
      continue;
    }
    const m = MORE_GUESTS.exec(name);
    if (!m) continue;
    // Taken BEFORE the quantity guard below: the threshold is a property of the question, which
    // was asked whether or not the customer picked this particular option.
    const t = Number(m[1]);
    if (Number.isFinite(t)) threshold = threshold === null ? t : Math.max(threshold, t);
    // An option the customer DECLINED is still on the wire, at quantity 0. Reading existence
    // instead of quantity reads back the answer they said no to — which is how a booking whose
    // only selected answer was "No-Good with 12" landed on the WOULD-BE-OVER list.
    //
    // A MISSING quantity is treated as selected, not skipped. Every observed row carries one, so
    // this only fires if Xola changes the shape — and on a Certificate-of-Inspection limit the
    // safe direction for an unknown is to raise the alert, not to swallow it. Same reasoning as
    // `max` below reporting the worst case when someone answered more than once.
    if (typeof a.quantity === "number" && a.quantity < 1) continue;
    const answer = (m[2] ?? "").trim();
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
  return { extra, declared, declaredMax, threshold, missingAddOnsKey };
}
