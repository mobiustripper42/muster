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
  type PaymentPort,
  type RefundInput,
} from "../ports/payment.js";

/** The signature the fake accepts — tests pass this as the "Stripe-Signature" header. */
export const FAKE_SIGNATURE = "fake-sig";

export class FakePaymentPort implements PaymentPort {
  /** Every session created, in order — assert against this in tests. */
  readonly created: CreateCheckoutInput[] = [];
  /** DISTINCT refunds (deduped by idempotencyKey) — assert against this in tests. */
  readonly refunds: RefundInput[] = [];
  /** Set to make `refund` throw, to exercise the manual-refund fallback path. */
  refundError: Error | null = null;
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

  parseCheckoutCompleted(rawBody: string, signature: string): CheckoutCompleted | null {
    if (signature !== FAKE_SIGNATURE) {
      throw new PaymentSignatureError("FakePaymentPort: bad signature");
    }
    // The test constructs the event body as CheckoutCompleted JSON (or "null" to model a
    // verified-but-ignored event type).
    return JSON.parse(rawBody) as CheckoutCompleted | null;
  }
}
