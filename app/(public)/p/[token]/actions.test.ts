/**
 * The payment link's pay action: the figures the page showed must be whole numbers of cents (issue
 * #1251), as at the checkout (`app/(public)/book/checkout/actions.test.ts`, issues #1217 and #1250).
 * A post without one — missing, a string, NaN, a fraction — is refused with the checkout's
 * price-changed words before anything is read or charged.
 *
 * **"Touches nothing", without a module mock.** The checkout's file reads a silent console, because
 * its first dependency past the gate is a cookie jar that throws outside a request. This action's
 * first dependencies are the Postgres repository and the Stripe port, which would quietly reach a
 * real database and a real provider. So every method on both prototypes is spied to refuse: nothing
 * past the gate can reach either, and the count says whether the action tried.
 *
 * The token is a real signed link for an operator's booking id, so the post passes the link check
 * wherever this gate sits among the others; their order is not tested here.
 *
 * AC6's wording for a `stale` refusal is checked on `REFUSAL` (`./refusal.ts`), not through the
 * action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresRepository } from "@core/adapters/postgres-repository.js";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { signPaymentLink } from "@core/reservations/payment-link.js";
import { signingSecret } from "../../../lib/auth";
import { startPaymentLinkCheckout } from "./actions.js";
import { REFUSAL } from "./refusal.js";

/** The checkout's words for a changed price (`docs/SPEC.md §2.8.4d`, issue #1217). Typed here: the
 *  project names no catalog for customer-facing text. */
const PRICE_CHANGED =
  "The price changed while you were checking out — reload to see the new total. You have not been charged.";

/** Spy every method on `proto` to reject, and report how many calls reached any of them. */
function refuseAll(proto: object): () => number {
  const spies = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor" && typeof Object.getOwnPropertyDescriptor(proto, name)?.value === "function")
    .map((name) =>
      vi
        .spyOn(proto as Record<string, (...args: unknown[]) => unknown>, name)
        .mockImplementation(() => Promise.reject(new Error(`test: ${name} was reached`))),
    );
  return () => spies.reduce((n, s) => n + s.mock.calls.length, 0);
}

let touched: () => number;

beforeEach(() => {
  // Stripe keys are a gate of their own — without them every post stops at "isn't configured".
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  const repo = refuseAll(PostgresRepository.prototype);
  const stripe = refuseAll(StripePaymentPort.prototype);
  touched = () => repo() + stripe();
  // The accepted post below reaches a refusing dependency, which the action logs.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A post that passes every gate: a live link, the terms ticked, the deposit page's figures. */
const valid = () => ({
  token: signPaymentLink("resv-0123456789abcdef0123456789abcdef", new Date(), signingSecret()),
  agreedToTerms: true,
  payDeposit: true,
  shownDueNowCents: 10000,
  shownBalanceCents: 55294,
});

async function post(input: Parameters<typeof startPaymentLinkCheckout>[0]) {
  const res = await startPaymentLinkCheckout(input);
  return { res, touched: touched() };
}

const REFUSED_UNTOUCHED = { res: { ok: false, message: PRICE_CHANGED }, touched: 0 };

const NOT_WHOLE_CENTS: [string, unknown][] = [
  ["null", null],
  ["a numeric string", "10000"],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["a fraction of a cent", 10000.5],
];

describe("startPaymentLinkCheckout — the figures the page showed (issue #1251)", () => {
  it("AC6: a post with no due-now gets the price-changed message and touches nothing", async () => {
    const { shownDueNowCents: _sent, ...withoutDueNow } = valid();
    expect(await post(withoutDueNow as ReturnType<typeof valid>)).toEqual(REFUSED_UNTOUCHED);
  });

  for (const [label, sent] of NOT_WHOLE_CENTS) {
    it(`AC6: a post whose due-now is ${label} gets the price-changed message and touches nothing`, async () => {
      expect(await post({ ...valid(), shownDueNowCents: sent as number })).toEqual(REFUSED_UNTOUCHED);
    });
  }

  it("AC6: a post with no balance gets the price-changed message and touches nothing", async () => {
    const { shownBalanceCents: _sent, ...withoutBalance } = valid();
    expect(await post(withoutBalance as ReturnType<typeof valid>)).toEqual(REFUSED_UNTOUCHED);
  });

  for (const [label, sent] of NOT_WHOLE_CENTS) {
    it(`AC6: a post whose balance is ${label} gets the price-changed message and touches nothing`, async () => {
      expect(await post({ ...valid(), shownBalanceCents: sent as number })).toEqual(REFUSED_UNTOUCHED);
    });
  }

  it("AC6: a post with whole-number figures passes this gate and goes on to the booking", async () => {
    // The guard that keeps the gate from refusing everything: this one is not the price-changed
    // answer, and it reached the repository.
    const { res, touched: calls } = await post(valid());
    expect(res.ok === false && res.message).not.toBe(PRICE_CHANGED);
    expect(calls).toBeGreaterThan(0);
  });
});

/**
 * A payment refused because the split changed under the page (`stale`) says what the checkout says
 * for a changed price. Read off the refusal map rather than through the action, which would need a
 * repository the action cannot be given.
 */
describe("REFUSAL — what a refused payment says", () => {
  it("AC6: a stale payment gets the checkout's price-changed message", () => {
    expect(REFUSAL.stale).toBe(PRICE_CHANGED);
  });
});
