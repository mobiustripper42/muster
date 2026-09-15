/**
 * In-process fake PaymentPort (DEC-107) — deterministic, no network. Lets the
 * charge→webhook→booking spine be tested end-to-end in the unit suite. The live
 * `StripePaymentPort` is the production twin.
 */
import {
  PaymentSignatureError,
  type CheckoutCompleted,
  type CheckoutSession,
  type CreateCheckoutInput,
  type CreatePaymentIntentInput,
  type PaymentEvent,
  type PaymentIntentState,
  type PaymentPort,
  type PaymentSucceeded,
  type RefundInput,
} from "../ports/payment.js";

/** The signature the fake accepts — tests pass this as the "Stripe-Signature" header. */
export const FAKE_SIGNATURE = "fake-sig";

export class FakePaymentPort implements PaymentPort {
  /** Every session created, in order — assert against this in tests. */
  readonly created: CreateCheckoutInput[] = [];
  /** Every PaymentIntent created, in order (12.5, DEC-134) — assert against this in tests. */
  readonly intents: CreatePaymentIntentInput[] = [];
  /** DISTINCT refunds (deduped by idempotencyKey) — assert against this in tests. */
  readonly refunds: RefundInput[] = [];
  /** Set to make `refund` throw, to exercise the manual-refund fallback path. */
  refundError: Error | null = null;
  /** Set to make `getReceiptUrl` throw, to exercise the book-anyway fallback (#679). */
  receiptUrlError: Error | null = null;
  readonly #refundsByKey = new Map<string, { refundId: string }>();
  /** Intents the provider will report as succeeded (issue #827). Anything absent resolves to
   *  `null`, which is how a forged `?payment_intent=` on the success URL is refused. */
  readonly succeededIntents = new Map<string, PaymentSucceeded>();

  // ── 15.8: one intent per pending row, raised rather than replaced ──────────────
  /** Every id this fake minted, so an unminted id reads `"unknown"` rather than `"reusable"`. */
  readonly #minted = new Set<string>();
  /** Override a specific intent's state — `settled` for one already paid, `unknown` for a status
   *  this build cannot describe. Unset ids fall back to whether the fake minted them. */
  readonly intentStates = new Map<string, PaymentIntentState>();
  /** Every amount raise, in order. Assert against this. */
  readonly amountUpdates: { paymentIntentId: string; amountCents: number }[] = [];
  /** **What the customer could still pay right now.** The whole point of 15.8: a superseded intent
   *  left at its old amount is a payable cheap booking, so a test asserts on this rather than on
   *  the intent count alone. */
  readonly liveAmountCents = new Map<string, number>();
  /** Make the state read throw — the caller must treat that as `"unknown"` and mint fresh. */
  intentStateError?: Error;
  /** Make the update throw — models the customer completing the first confirm in another tab
   *  between our state read and our update, a race no read can close. */
  updateAmountError?: Error;

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    this.created.push(input);
    // Session id = the ordinal; the webhook uses this id as the booking idempotency key
    // (Stripe mints it — it is NOT carried in metadata). Tests read the returned id.
    const id = `cs_fake_${this.created.length}`;
    return { id, url: `https://fake.stripe.test/checkout/${id}` };
  }

  async refund(input: RefundInput): Promise<{ refundId: string }> {
    if (this.refundError) throw this.refundError;
    // Model Stripe's keyed idempotency: the same key returns the same refund, and records
    // NO second entry — so a redelivered webhook can't double-refund.
    const existing = this.#refundsByKey.get(input.idempotencyKey);
    if (existing) return existing;
    const result = { refundId: `re_fake_${this.refunds.length + 1}` };
    this.refunds.push(input);
    this.#refundsByKey.set(input.idempotencyKey, result);
    return result;
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    this.intents.push(input);
    // Intent id = the ordinal; the webhook uses this id as the booking idempotency key
    // (Stripe mints it — it is NOT carried in metadata). Tests read the returned id.
    const id = `pi_fake_${this.intents.length}`;
    this.#minted.add(id);
    this.liveAmountCents.set(id, input.amountCents);
    return { clientSecret: `${id}_secret_test`, paymentIntentId: id };
  }

  async getSucceededPaymentIntent(paymentIntentId: string): Promise<PaymentSucceeded | null> {
    return this.succeededIntents.get(paymentIntentId) ?? null;
  }

  async getPaymentIntentState(paymentIntentId: string): Promise<PaymentIntentState> {
    if (this.intentStateError) throw this.intentStateError;
    // Anything this fake minted is reusable unless a test says otherwise, because that is the
    // ordinary case: an intent sitting unpaid or declined, waiting for another attempt.
    return (
      this.intentStates.get(paymentIntentId) ??
      (this.#minted.has(paymentIntentId) ? "reusable" : "unknown")
    );
  }

  async updatePaymentIntentAmount(
    paymentIntentId: string,
    amountCents: number,
  ): Promise<{ clientSecret: string }> {
    if (this.updateAmountError) {
      // **Refused, and the state moves with it.** Stripe rejects an update because the intent is no
      // longer updatable, and the dominant reason for that is that it just succeeded. Leaving the
      // state at `reusable` would model a refusal that cannot happen, and would let a test "pass"
      // without ever reaching the caller's re-read. A test that wants a refusal on an intent that
      // is genuinely dead can set `intentStates` itself afterwards.
      this.intentStates.set(paymentIntentId, "settled");
      throw this.updateAmountError;
    }
    this.amountUpdates.push({ paymentIntentId, amountCents });
    this.liveAmountCents.set(paymentIntentId, amountCents);
    return { clientSecret: `${paymentIntentId}_secret_test` };
  }

  async getReceiptUrl(paymentIntentId: string): Promise<string | undefined> {
    if (this.receiptUrlError) throw this.receiptUrlError;
    return `https://pay.stripe.test/receipts/${paymentIntentId}`;
  }

  parseEvent(rawBody: string, signature: string): PaymentEvent | null {
    if (signature !== FAKE_SIGNATURE) {
      throw new PaymentSignatureError("FakePaymentPort: bad signature");
    }
    // The test synthesizes the event body as JSON: either the tagged union
    // ({ type: "checkout_completed" | "payment_succeeded", data: … }), a BARE
    // `CheckoutCompleted` (the pre-12.5 idiom — sniffed by `sessionId` and wrapped, so the
    // existing hosted-path tests keep reading naturally), or "null" to model a
    // verified-but-ignored event type.
    const parsed = JSON.parse(rawBody) as
      | PaymentEvent
      | (CheckoutCompleted & { type?: undefined })
      | null;
    if (parsed === null) return null;
    if (
      parsed.type === "checkout_completed" ||
      parsed.type === "payment_succeeded" ||
      parsed.type === "refund_recorded" ||
      parsed.type === "dispute_updated" ||
      parsed.type === "payment_failed"
    ) {
      return parsed;
    }
    return { type: "checkout_completed", data: parsed as CheckoutCompleted };
  }
}
