/**
 * One module moves refund money (issue #1278, AC19).
 *
 * Every refund is a refund record first, sent under a key taken from that record, and only
 * `sendRefundRecord` in `refund-payment.ts` does that. A new path that called the payment port's
 * `refund` directly would skip all four steps and pass every behavioural test written for it, so
 * the check is on the source: any other file calling `.refund(` fails here.
 *
 * Defining `refund` on an adapter is not a call, and test files are not source.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_DIRS = ["src", "app", "components", "db"];
const THE_ONE = "src/reservations/refund-payment.ts";
/** A call of `.refund(`, allowing whitespace and a line break between the dot and `refund` and
 *  before the bracket, so `payments\n  .refund(` is caught too. */
const CALLS_REFUND = /\.\s*refund\s*\(/;

/** Every non-test `.ts`/`.tsx` under a directory, recursively. */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourcesUnder(p));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe("the payment port's refund is called from one module (issue #1278)", () => {
  const files = SOURCE_DIRS.flatMap((d) => sourcesUnder(join(ROOT, d)));

  it("AC19: finds the source at all, the one module included", () => {
    // Without this, a moved directory turns the check below into a pass over nothing.
    expect(files.map((f) => relative(ROOT, f))).toContain(THE_ONE);
  });

  it("AC19: no source file but refund-payment.ts calls .refund(", () => {
    const callers = files
      .filter((f) => CALLS_REFUND.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f))
      .filter((f) => f !== THE_ONE);

    expect(callers).toEqual([]);
  });

  it("AC19: the search catches a call spaced out or split across lines, and not a definition", () => {
    // The search above is only as good as this matcher: a call written over two lines must not
    // pass it, and an adapter defining `refund` must not fail it.
    const calls = ["payments.refund(input)", "deps.payments\n    .refund({ amountCents })", "payments. refund (input)", "payments.\n  refund\n  (input)"];
    const notCalls = ["async refund(input: RefundInput) {", "repo.refundReservation(id)", "payment.refunded(x)", "refund(input)"];

    expect(calls.filter((s) => !CALLS_REFUND.test(s))).toEqual([]);
    expect(notCalls.filter((s) => CALLS_REFUND.test(s))).toEqual([]);
  });
});
