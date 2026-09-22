/**
 * `startElementsCheckout` must never reject (issue #773).
 *
 * **This is the last screen before money moves**, and it is the one place in the checkout where
 * the project's own convention was broken: `.claude/CLAUDE-context.md` § Conventions → Error
 * Handling says *"Never `throw` in server actions — return errors for inline feedback."* Every
 * ANTICIPATED failure in this action already returns `{ ok: false, message }` — flag off,
 * unconfigured keys, missing name, bad phone, ungated waiver. The unanticipated ones — a Stripe
 * outage, a dropped connection, a cold database — threw, and the customer's only signal was the
 * Pay button coming back.
 *
 * So the property under test is not "it handles a Stripe outage nicely". It is **the function
 * cannot reject, whatever its dependencies do** — which is a claim about every future dependency
 * this action grows, not just today's. A test is the only thing that can hold that.
 *
 * Mocking five modules is more scaffolding than this repo usually puts behind a server action,
 * and it earns it here: the assertion is on the action's own return value, so there is something
 * real to assert. (Contrast the trail emitters, where the observable effect was a database row
 * nothing rendered — those stayed hand-checked on purpose.)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const createDeparturePaymentIntent = vi.fn();
const cookiesFn = vi.fn();

vi.mock("@core/reservations/create-departure-payment-intent.js", () => ({
  createDeparturePaymentIntent: (...args: unknown[]) => createDeparturePaymentIntent(...args),
}));
vi.mock("next/headers", () => ({ cookies: () => cookiesFn() }));
vi.mock("../../../lib/repo", () => ({ getRepo: () => ({}) }));
vi.mock("../../../lib/flags", () => ({ reservationsEnabled: () => true }));
vi.mock("@core/adapters/stripe-payment.js", () => ({
  StripePaymentPort: class {},
}));

const { startElementsCheckout } = await import("./actions.js");

/** A submission that passes every gate the action checks before it reaches its dependencies —
 *  so anything that goes wrong afterwards is the dependency, which is the point. */
const VALID = {
  offeringId: "off-1",
  date: "2026-07-04",
  time: "13:30",
  guests: 4,
  gratuityBps: 2000,
  customerName: "Mary Brody",
  email: "m@x.io",
  phone: "+12165550148",
  waiverConsent: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  // A working cookie jar; the holder-token read is not what these cases are about.
  cookiesFn.mockResolvedValue({ get: () => undefined, set: () => {} });
});

describe("startElementsCheckout — it cannot reject", () => {
  it("returns ok:false when the payment intent call THROWS", async () => {
    // The defect, in one line. `createDeparturePaymentIntent` talks to Stripe and to Postgres;
    // either can fail in a way no guard above anticipates.
    createDeparturePaymentIntent.mockRejectedValue(new Error("stripe: 503 service unavailable"));

    const res = await startElementsCheckout(VALID);

    expect(res.ok).toBe(false);
  });

  it("tells the customer NOTHING WAS CHARGED — the only fact they need", async () => {
    // Matching the posture of the configured-keys refusal a few lines up, which already says it.
    // A customer looking at a failed payment form has exactly one question, and leaving them to
    // guess is what makes them tap Pay again.
    createDeparturePaymentIntent.mockRejectedValue(new Error("boom"));

    const res = await startElementsCheckout(VALID);

    expect(res.ok === false && res.message).toMatch(/not been charged|nothing was charged/i);
  });

  it("never leaks the provider's error text to the customer", async () => {
    // Same rule the trail emitters follow (`describeSendFailure`, issue #1052): a provider's
    // verbatim response body can carry a recipient address, an internal host, or a key prefix.
    // A checkout form is a worse place to print one than a log line.
    createDeparturePaymentIntent.mockRejectedValue(
      new Error("pg: connection to server at 10.0.0.4:5432 failed — password authentication"),
    );

    const res = await startElementsCheckout(VALID);

    expect(res.ok === false && res.message).not.toMatch(/10\.0\.0\.4|password|pg:/);
  });

  it("returns ok:false when the COOKIE JAR throws, not just the payment call", async () => {
    // `readOrMintHolderToken` already catches its own failure — this pins that the catch stays,
    // because the action reaching a throw from ANY dependency is the property, not just from the
    // one that happens to be riskiest today.
    cookiesFn.mockImplementation(() => {
      throw new Error("cookies() unavailable in this context");
    });
    createDeparturePaymentIntent.mockResolvedValue({
      ok: true,
      clientSecret: "cs_x",
      paymentIntentId: "pi_x",
    });

    await expect(startElementsCheckout(VALID)).resolves.toMatchObject({ ok: true });
  });

  it("still returns the SPECIFIC message for an anticipated failure", async () => {
    // The guard that keeps the fix honest. A blanket try/catch that swallowed everything into one
    // generic message would pass every case above and make the checkout worse — the anticipated
    // failures have specific, actionable copy and must keep it.
    createDeparturePaymentIntent.mockResolvedValue({ ok: true, clientSecret: "cs", paymentIntentId: "pi" });

    const res = await startElementsCheckout({ ...VALID, phone: "nonsense" });

    expect(res.ok === false && res.message).toMatch(/mobile number/i);
  });

  it("passes a successful start straight through", async () => {
    createDeparturePaymentIntent.mockResolvedValue({
      ok: true,
      clientSecret: "cs_live_x",
      paymentIntentId: "pi_live_x",
    });

    await expect(startElementsCheckout(VALID)).resolves.toMatchObject({
      ok: true,
      clientSecret: "cs_live_x",
    });
  });
});
