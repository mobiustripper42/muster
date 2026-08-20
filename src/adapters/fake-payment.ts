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
  type PaymentPort,
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
    return { clientSecret: `${id}_secret_test`, paymentIntentId: id };
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
      parsed.type === "refund_recorded"
    ) {
      return parsed;
    }
    return { type: "checkout_completed", data: parsed as CheckoutCompleted };
  }
}
