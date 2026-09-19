/**
 * `StripePaymentPort.parseEvent` — the webhook mapping, against real signed payloads (15.12).
 *
 * **This file covers `parseEvent` and nothing else, deliberately.** It is the only pure function in
 * a 491-line adapter; every other method is a network call, and a unit test of those would have to
 * `vi.mock("stripe")` — mocking the thing under test. The network half is covered by
 * `npm run db:stripe:cancel`, which runs the real adapter against the sandbox. Two mechanisms, each
 * suiting its half, rather than one suiting neither.
 *
 * **Payloads are signed, not hand-built.** `Stripe.webhooks.generateTestHeaderString` produces a
 * real signature that `constructEvent` verifies, so these tests exercise the verification path the
 * route depends on. A test that stubbed verification would prove the mapping and nothing about the
 * thing in front of it.
 *
 * (If the sync helper ever throws `CryptoProviderOnlySupportsAsyncError` — it cannot under Node,
 * whose provider is synchronous — the fix is `generateTestHeaderStringAsync`, never a mock.)
 */
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { PaymentSignatureError } from "../ports/payment.js";
import { StripePaymentPort } from "./stripe-payment.js";

const SECRET = "whsec_test_secret_for_signing_only_not_a_real_key";
const port = new StripePaymentPort("sk_test_not_a_real_key", SECRET);

/** A signed webhook body, exactly as Stripe would deliver it. */
function signed(type: string, object: Record<string, unknown>): [string, string] {
  const payload = JSON.stringify({
    id: "evt_test",
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: 1_780_000_000,
    type,
    data: { object },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return [payload, header];
}

const parse = (type: string, object: Record<string, unknown>) => port.parseEvent(...signed(type, object));

describe("parseEvent — the Stripe event id travels with the event (15.13)", () => {
  it("carries the Stripe event id, whatever the type", () => {
    // **Without this there is nothing joining two records of one failure.** Stripe's Workbench
    // shows a delivery with an id; Vercel shows `Stripe webhook processing failed: …`. Both are
    // real, neither names the other, and `parseEvent` has been reading `event.id` off the verified
    // event and discarding it this whole time.
    expect(parse("payment_intent.succeeded", { id: "pi_x", amount_received: 1, currency: "usd", metadata: {} }))
      .toMatchObject({ stripeEventId: "evt_test" });
    // On a second type too — it belongs to the envelope, not to any one member's `data`.
    expect(parse("payment_intent.processing", { id: "pi_y" })).toMatchObject({
      stripeEventId: "evt_test",
    });
  });
});

describe("parseEvent — every named member is reachable from a signed payload (15.12)", () => {
  it("names payment_intent.processing rather than dropping it", () => {
    // **The defect this task exists for.** Before 15.12 every `if` in `parseEvent` missed this type
    // and it fell to `return null` — indistinguishable from an event we have never heard of.
    // `payment_failed` and `payment_canceled` both carry named members for exactly this reason:
    // ignored-on-purpose and unrecognised must not be the same signal.
    //
    // It matters on `/book` specifically. That path sends `automatic_payment_methods: {enabled:true}`,
    // so method selection lives in the Dashboard — a delayed method is one toggle away with no code
    // change, and the day it is flipped, `processing` is what arrives.
    expect(parse("payment_intent.processing", { id: "pi_1" })).toEqual({
      stripeEventId: "evt_test",
      type: "payment_processing",
      data: { paymentIntentId: "pi_1" },
    });
  });

  it("maps checkout.session.completed, carrying the intent id only when it is a string", () => {
    expect(
      parse("checkout.session.completed", {
        id: "cs_1",
        payment_intent: "pi_1",
        amount_total: 5000,
        currency: "usd",
        metadata: { purpose: "balance" },
      }),
    ).toEqual({
      stripeEventId: "evt_test",
      type: "checkout_completed",
      data: {
        sessionId: "cs_1",
        paymentIntentId: "pi_1",
        amountTotalCents: 5000,
        currency: "usd",
        metadata: { purpose: "balance" },
      },
    });
  });

  it("maps payment_intent.succeeded", () => {
    expect(
      parse("payment_intent.succeeded", {
        id: "pi_2",
        amount_received: 6200,
        currency: "usd",
        metadata: {},
      }),
    ).toMatchObject({ type: "payment_succeeded", data: { paymentIntentId: "pi_2" } });
  });

  it("maps payment_intent.payment_failed and carries the decline code", () => {
    expect(
      parse("payment_intent.payment_failed", {
        id: "pi_3",
        last_payment_error: { decline_code: "insufficient_funds" },
      }),
    ).toEqual({
      stripeEventId: "evt_test",
      type: "payment_failed",
      data: { paymentIntentId: "pi_3", declineCode: "insufficient_funds" },
    });
  });

  it("maps payment_intent.canceled and carries the cancellation reason", () => {
    expect(parse("payment_intent.canceled", { id: "pi_4", cancellation_reason: "abandoned" })).toEqual({
      stripeEventId: "evt_test",
      type: "payment_canceled",
      data: { paymentIntentId: "pi_4", reason: "abandoned" },
    });
  });

  it("maps charge.refunded with the CUMULATIVE refunded total", () => {
    // `amount_refunded` is the running total on the charge, not the delta of this refund — which is
    // what makes a redelivery and a second partial refund the identical write.
    expect(
      parse("charge.refunded", {
        payment_intent: "pi_5",
        amount_refunded: 2500,
        currency: "usd",
      }),
    ).toMatchObject({ type: "refund_recorded", data: { amountRefundedCents: 2500 } });
  });

  it("maps a dispute and normalizes its status", () => {
    const r = parse("charge.dispute.created", {
      payment_intent: "pi_6",
      status: "warning_needs_response",
      amount: 5000,
      currency: "usd",
      reason: "fraudulent",
    });
    // The `warning_*` family is a retrieval request: no funds have moved. Mapping it to `live`
    // would zero out revenue on a booking that was never charged back.
    expect(r).toMatchObject({ type: "dispute_updated", data: { state: "inquiry" } });
  });

  it("returns null for a type we have never heard of — deliberately, and it is not the same as above", () => {
    expect(parse("invoice.paid", { id: "in_1" })).toBeNull();
  });
});

describe("parseEvent — verification (15.12)", () => {
  it("throws PaymentSignatureError on a bad signature, not a generic Error", () => {
    // **Characterization, not a new behaviour.** This distinction is what makes the route answer
    // 400 rather than 500 (`app/api/webhooks/stripe/route.ts`), and 500 is what tells Stripe to
    // retry. Nothing held it before this file: a refactor that let the raw Stripe error escape
    // would turn every forged request into three days of retries, with the whole suite green.
    const [payload] = signed("payment_intent.succeeded", { id: "pi_7" });
    expect(() => port.parseEvent(payload, "t=1,v1=deadbeef")).toThrow(PaymentSignatureError);
  });

  it("throws on a payload that does not match its signature", () => {
    const [, header] = signed("payment_intent.succeeded", { id: "pi_8" });
    expect(() => port.parseEvent('{"tampered":true}', header)).toThrow(PaymentSignatureError);
  });
});
