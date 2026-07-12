/**
 * In-process fake PaymentPort (DEC-107) — deterministic, no network. Lets the
 * charge→webhook→booking spine be tested end-to-end in the unit suite. The live
 * `StripePaymentPort` is the production twin.
 */
import type {
  CheckoutCompleted,
  CheckoutSession,
  CreateCheckoutInput,
  PaymentPort,
} from "../ports/payment.js";

/** The signature the fake accepts — tests pass this as the "Stripe-Signature" header. */
export const FAKE_SIGNATURE = "fake-sig";

export class FakePaymentPort implements PaymentPort {
  /** Every session created, in order — assert against this in tests. */
  readonly created: CreateCheckoutInput[] = [];

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    this.created.push(input);
    // Session id = the ordinal; the webhook uses this id as the booking idempotency key
    // (Stripe mints it — it is NOT carried in metadata). Tests read the returned id.
    const id = `cs_fake_${this.created.length}`;
    return { id, url: `https://fake.stripe.test/checkout/${id}` };
  }

  parseCheckoutCompleted(rawBody: string, signature: string): CheckoutCompleted | null {
    if (signature !== FAKE_SIGNATURE) {
      throw new Error("FakePaymentPort: bad signature");
    }
    // The test constructs the event body as CheckoutCompleted JSON (or "null" to model a
    // verified-but-ignored event type).
    return JSON.parse(rawBody) as CheckoutCompleted | null;
  }
}
