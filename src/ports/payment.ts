/**
 * Payment provider port (DEC-107) — Muster hides side-effecting infra behind ports (the
 * channel port DEC-MSG, presence DEC-068), so Stripe lives behind this seam with a live
 * `StripePaymentPort` and a `FakePaymentPort`. That's what makes the charge→booking spine
 * testable without hitting Stripe.
 *
 * **No `refund` method** — refunds are ALWAYS manual in the Stripe dashboard (operator
 * decision); nothing in Muster issues a programmatic refund. The port only takes money in
 * and parses the resulting webhook.
 */

/**
 * Thrown by `parseCheckoutCompleted` when the webhook signature is invalid/absent — a
 * client error (return 400). Distinct from an infra failure downstream (return 500 so
 * Stripe RETRIES rather than dropping the event).
 */
export class PaymentSignatureError extends Error {}

export interface CreateCheckoutInput {
  /** Amount to charge now, integer cents (deposit or full — computed by the caller). */
  amountCents: number;
  /** Tax portion of `amountCents`, cents (recorded on the resulting Payment). */
  taxCents: number;
  /** ISO-4217 lowercase, e.g. "usd". */
  currency: string;
  /** Line-item label the customer sees (e.g. the offering/vessel + date). */
  productName: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Opaque key/value carried through Stripe back to the webhook: `eventId`, `partySize`,
   * `kind`, `customerName`, `email`, `phone`. The webhook rebuilds the `BookingRequest`
   * from these and uses the returned session id as the booking idempotency key (so a
   * re-delivered webhook maps to the same reservation).
   */
  metadata: Record<string, string>;
}

export interface CheckoutSession {
  /** Stripe Checkout session id — becomes the Payment id seed + the booking idempotency key. */
  id: string;
  /** The hosted-Checkout URL to redirect the customer to. */
  url: string;
}

/** A verified `checkout.session.completed` event, normalized off the provider's shape. */
export interface CheckoutCompleted {
  sessionId: string;
  paymentIntentId?: string;
  amountTotalCents: number;
  currency: string;
  metadata: Record<string, string>;
}

export interface PaymentPort {
  /** Create a hosted-Checkout session for one charge; returns the redirect URL. */
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /**
   * Verify the webhook signature and normalize the event. Returns the completed checkout
   * for a `checkout.session.completed` event, or **`null`** for any other (verified) event
   * type the caller should acknowledge and ignore. **Throws on an invalid/absent
   * signature** — the port owns verification so the fake can synthesize events in tests
   * without a real Stripe signature.
   */
  parseCheckoutCompleted(rawBody: string, signature: string): CheckoutCompleted | null;
}
