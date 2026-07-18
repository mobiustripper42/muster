/**
 * Payment provider port (DEC-107) — Muster hides side-effecting infra behind ports (the
 * channel port DEC-MSG, presence DEC-068), so Stripe lives behind this seam with a live
 * `StripePaymentPort` and a `FakePaymentPort`. That's what makes the charge→booking spine
 * testable without hitting Stripe.
 *
 * **Refunds (DEC-107 amended, 12.1b):** the port issues a programmatic `refund` for the
 * ONE unavoidable automatic case — the DEC-109 residual-race loser (both paid, one won the
 * atomic claim; the loser is auto-refunded + told "sold out while you were paying"). All
 * OTHER refunds remain operator-discretion, done manually in the Stripe dashboard. The
 * refund is keyed-idempotent so a re-delivered webhook can't double-refund.
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

export interface RefundInput {
  /** The PaymentIntent to refund (from `CheckoutCompleted.paymentIntentId`). */
  paymentIntentId: string;
  /** Partial amount in cents; omit for a FULL refund. */
  amountCents?: number;
  /** Idempotency key — the same key returns the same refund, never a second one. The
   *  webhook passes `refund_${sessionId}` so a Stripe redelivery of the losing session is a
   *  no-op refund. */
  idempotencyKey: string;
}

export interface PaymentPort {
  /** Create a hosted-Checkout session for one charge; returns the redirect URL. */
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /**
   * Refund a captured payment (DEC-107 amended, 12.1b) — the residual-race auto-refund.
   * Keyed-idempotent: a re-delivered webhook re-calls with the same `idempotencyKey` and
   * gets the same refund back, never a double refund. Throws on a provider/network failure
   * (the caller falls back to a loud manual-refund alert — never a silent unrefunded loss).
   */
  refund(input: RefundInput): Promise<{ refundId: string }>;
  /**
   * Verify the webhook signature and normalize the event. Returns the completed checkout
   * for a `checkout.session.completed` event, or **`null`** for any other (verified) event
   * type the caller should acknowledge and ignore. **Throws on an invalid/absent
   * signature** — the port owns verification so the fake can synthesize events in tests
   * without a real Stripe signature.
   */
  parseCheckoutCompleted(rawBody: string, signature: string): CheckoutCompleted | null;
}
