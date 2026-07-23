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
 * Thrown by `parseEvent` when the webhook signature is invalid/absent — a client error
 * (return 400). Distinct from an infra failure downstream (return 500 so Stripe RETRIES
 * rather than dropping the event).
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

/**
 * Input for a raw PaymentIntent (12.5, DEC-134) — the inline-Elements twin of
 * `CreateCheckoutInput`: same money + metadata, but NO success/cancel URL (Elements confirms
 * client-side with a `return_url`) and no line-item label (there is no hosted page). The
 * webhook rebuilds the booking from `metadata` and uses the PaymentIntent id as the booking
 * idempotency key — exactly the session id's role on the hosted path.
 */
export interface CreatePaymentIntentInput {
  /** Amount to charge now, integer cents (deposit or full — computed by the caller). */
  amountCents: number;
  /** ISO-4217 lowercase, e.g. "usd". */
  currency: string;
  /** Opaque key/value carried through Stripe back to the webhook — the frozen slot + money
   *  fields (see `createDeparturePaymentIntent`). MUST include `purpose`: the webhook's
   *  `payment_intent.succeeded` handler processes only purposed intents (DEC-134 double-write
   *  guard — the PI underlying a hosted session has no metadata and is acked-and-ignored). */
  metadata: Record<string, string>;
}

/** A verified `payment_intent.succeeded` event, normalized off the provider's shape. */
export interface PaymentSucceeded {
  paymentIntentId: string;
  amountReceivedCents: number;
  currency: string;
  metadata: Record<string, string>;
}

/**
 * The verified-webhook event union (12.5, DEC-134). `checkout_completed` drives the hosted
 * flows (balance + post-gratuity); `payment_succeeded` drives the inline-Elements booking.
 */
export type PaymentEvent =
  | { type: "checkout_completed"; data: CheckoutCompleted }
  | { type: "payment_succeeded"; data: PaymentSucceeded };

export interface RefundInput {
  /** The PaymentIntent to refund (from `CheckoutCompleted.paymentIntentId`). */
  paymentIntentId: string;
  /** Partial amount in cents; omit for a FULL refund. */
  amountCents?: number;
  /** Idempotency key — the same key returns the same refund, never a second one. The
   *  webhook passes `refund_${sessionId}` (hosted) / `refund_${paymentIntentId}` (Elements)
   *  so a Stripe redelivery of the losing charge is a no-op refund. */
  idempotencyKey: string;
}

export interface PaymentPort {
  /** Create a hosted-Checkout session for one charge; returns the redirect URL. */
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /**
   * Create a raw PaymentIntent for one charge (12.5, DEC-134) — the inline-Elements path.
   * Returns the `clientSecret` the client confirms against and the intent id (the booking
   * idempotency key once `payment_intent.succeeded` lands).
   */
  createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<{ clientSecret: string; paymentIntentId: string }>;
  /**
   * Refund a captured payment (DEC-107 amended, 12.1b) — the residual-race auto-refund.
   * Keyed-idempotent: a re-delivered webhook re-calls with the same `idempotencyKey` and
   * gets the same refund back, never a double refund. Throws on a provider/network failure
   * (the caller falls back to a loud manual-refund alert — never a silent unrefunded loss).
   */
  refund(input: RefundInput): Promise<{ refundId: string }>;
  /**
   * Verify the webhook signature and normalize the event (12.5, DEC-134). Returns the
   * discriminated union for a `checkout.session.completed` or `payment_intent.succeeded`
   * event, or **`null`** for any other (verified) event type the caller should acknowledge
   * and ignore. **Throws on an invalid/absent signature** — the port owns verification so
   * the fake can synthesize events in tests without a real Stripe signature.
   */
  parseEvent(rawBody: string, signature: string): PaymentEvent | null;
}
