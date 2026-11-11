/**
 * Payment-config money math (DEC-107 / DEC-134) — pins the fee formula and the
 * deposit→balance arithmetic so the service fee can never be charged twice or leak into
 * the balance. Pure functions only; the builders/webhook are covered by their own suites.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Payment, PaymentStatus } from "../domain/entities.js";
import {
  balanceOwedCents,
  countsAsPaid,
  depositOffered,
  dueNowCents,
  feeCentsFor,
  parseDepositCents,
  tookMoney,
  PAYMENT_CONFIG_DEFAULTS,
} from "./payment-config.js";

describe("feeCentsFor (DEC-134)", () => {
  it("is serviceFeeBps of the fare, rounded half-up, integer cents", () => {
    expect(feeCentsFor(49900, 300)).toBe(1497); // 3% of $499.00
    expect(feeCentsFor(57900, 300)).toBe(1737); // 3% of $579.00 (mockup's $17.37)
    expect(feeCentsFor(10001, 300)).toBe(300); // 300.03 → 300
    expect(feeCentsFor(10050, 300)).toBe(302); // 301.5 rounds half-up
    expect(feeCentsFor(0, 300)).toBe(0);
    expect(feeCentsFor(49900, 0)).toBe(0); // fee disabled
  });

  it("default rate is 300 bps (3%)", () => {
    expect(PAYMENT_CONFIG_DEFAULTS.serviceFeeBps).toBe(300);
  });
});

/**
 * The fixed deposit's stored value (issue #1250, `docs/SPEC.md §2.8.4d`). A whole number of cents in
 * `app_settings`; absent is the $100 default, and anything that is not whole cents reads as the
 * default and is logged — a typo in a hand-written SQL row must not turn the deposit off silently.
 * The edge cases live here, at the parse; `getPaymentConfig` gets one case either side in the
 * repository contract.
 */
describe("parseDepositCents", () => {
  afterEach(() => vi.restoreAllMocks());

  it("AC1: absent reads as 10000, silently — the fallback is not an error", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseDepositCents(null)).toBe(10000);
    expect(parseDepositCents(undefined)).toBe(10000);
    expect(err).not.toHaveBeenCalled();
  });

  it("AC2: a whole number of cents reads as itself, 0 included", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseDepositCents("15000")).toBe(15000);
    expect(parseDepositCents(" 7500 ")).toBe(7500);
    expect(parseDepositCents("0")).toBe(0);
    expect(err).not.toHaveBeenCalled();
  });

  it.each(["abc", "-5", "10.5", "", "100 dollars"])("AC2: %j reads as 10000 and is logged", (raw) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseDepositCents(raw)).toBe(10000);
    expect(err).toHaveBeenCalledOnce();
  });
});

/**
 * The one split of a quote into now and later (issue #1250). The charge and the screen both call it,
 * so the at-or-below boundary is pinned here and only here.
 */
describe("dueNowCents", () => {
  it("AC3: a quote above the deposit owes the deposit now", () => {
    expect(dueNowCents(65294, 10000)).toBe(10000);
    expect(dueNowCents(10001, 10000)).toBe(10000);
  });

  it("AC6: a quote at or below the deposit is due whole", () => {
    expect(dueNowCents(10000, 10000)).toBe(10000);
    expect(dueNowCents(9999, 10000)).toBe(9999);
    expect(dueNowCents(0, 10000)).toBe(0);
  });

  it("AC5: no deposit (inside the balance window, or none asked) is the whole quote", () => {
    expect(dueNowCents(65294, null)).toBe(65294);
  });
});

describe("depositOffered", () => {
  it("AC16: outside the balance window, a quote above the deposit is offered one", () => {
    expect(depositOffered(65294, 10000, false)).toBe(true);
    expect(depositOffered(10001, 10000, false)).toBe(true);
  });

  it("AC6: a quote at or below the deposit is not", () => {
    expect(depositOffered(10000, 10000, false)).toBe(false);
    expect(depositOffered(9999, 10000, false)).toBe(false);
  });

  it("AC5: inside the balance window nothing is", () => {
    expect(depositOffered(65294, 10000, true)).toBe(false);
  });
});

/**
 * `countsAsPaid` is an ALLOW-list, and that is the whole point (issue #723).
 *
 * It used to read `status !== "refunded"` — a DENY-list. The comment above `balanceOwedCents`
 * claimed the compiler would force a revisit when `PaymentStatus` widened "to disputes or
 * chargebacks". It would not have: `!== "refunded"` type-checks perfectly against a wider
 * union, so adding `disputed` would have compiled clean and silently counted a chargeback as
 * money in FIVE places — `balanceOwedCents`, `/admin/purchases`, the calendar detail, the
 * cancel refund math, and `refund-payment`'s guard.
 *
 * The DB column carries no CHECK constraint either (DEC-131), so this function is the only
 * guard that exists. An allow-list fails the safe way: a state nobody has taught it about is
 * not money.
 */
describe("countsAsPaid — an allow-list, so a new status is never silently money", () => {
  const withStatus = (status: PaymentStatus) => ({ status });

  it("counts a succeeded payment", () => {
    expect(countsAsPaid(withStatus("succeeded"))).toBe(true);
  });

  it("counts a partially refunded payment — the remainder is still real money", () => {
    // Only the refunded PART went back, so the row still counts. `balanceOwedCents` does not
    // read this: it counts `tookMoney` rows (issue #841).
    expect(countsAsPaid(withStatus("partially_refunded"))).toBe(true);
  });

  it("does not count a fully refunded payment", () => {
    expect(countsAsPaid(withStatus("refunded"))).toBe(false);
  });

  it("does not count a payment under dispute — the funds are gone while it runs", () => {
    expect(countsAsPaid(withStatus("disputed"))).toBe(false);
  });

  it("does not count a dispute we lost", () => {
    expect(countsAsPaid(withStatus("dispute_lost"))).toBe(false);
  });

  it("does not count a status it has never been taught", () => {
    // The regression guard for the next widening, whatever it is — a deny-list passes this
    // test only by accident and a future one never at all. The cast is deliberate: it
    // simulates a value reaching the function that the union does not yet carry, which is
    // exactly what a stale ledger row or a future migration produces.
    expect(countsAsPaid({ status: "chargeback_pending" as PaymentStatus })).toBe(false);
  });
});

/**
 * What took money, whether or not it is still paid (issue #841). `balanceOwedCents` counts these:
 * a refund lowers the price and the amount paid together, so a `refunded` row stays in the sum. An
 * allow-list for the same reason as `countsAsPaid`: a state nobody taught it is not money.
 */
describe("tookMoney — an allow-list of the statuses that took money", () => {
  const withStatus = (status: PaymentStatus) => ({ status });

  it("AC2: a succeeded payment took money", () => {
    expect(tookMoney(withStatus("succeeded"))).toBe(true);
  });

  it("AC2: a partially refunded payment took money", () => {
    expect(tookMoney(withStatus("partially_refunded"))).toBe(true);
  });

  it("AC2: a fully refunded payment took money, though it no longer counts as paid", () => {
    expect(tookMoney(withStatus("refunded"))).toBe(true);
  });

  it("AC4: a payment under dispute did not", () => {
    expect(tookMoney(withStatus("disputed"))).toBe(false);
  });

  it("AC4: a dispute we lost did not", () => {
    expect(tookMoney(withStatus("dispute_lost"))).toBe(false);
  });

  it("AC4: a status it has never been taught did not", () => {
    // The cast is deliberate, as in the `countsAsPaid` test above: a stale ledger row or a future
    // migration can carry a value the union does not.
    expect(tookMoney({ status: "chargeback_pending" as PaymentStatus })).toBe(false);
  });
});

describe("balanceOwedCents treats a disputed payment as unpaid (issue #723)", () => {
  it("re-opens the full balance when the only payment is disputed", () => {
    // fare 49900 @ 725bps → tax 3618, total 53518. One full payment, then a chargeback.
    // While the money is withdrawn the booking owes the whole amount again — the fail-safe
    // direction, and what makes the dispute visible on /admin/purchases at all.
    const disputed: Pick<Payment, "status" | "amountCents" | "serviceFeeCents"> = {
      status: "disputed",
      amountCents: 55015,
      serviceFeeCents: 1497,
    };
    expect(balanceOwedCents(49900, 725, [disputed])).toBe(53518);
  });
});
