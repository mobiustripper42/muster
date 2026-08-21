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
  /**
   * Where the provider sends the payment receipt (#679). **Optional because email is optional at
   * `/book`** — phone is the required contact (DEC-132). No email ⇒ no receipt, which is an
   * ordinary booking rather than an error.
   */
  receiptEmail?: string;
  /**
   * One human-readable line identifying the departure (#679). A raw PaymentIntent has NO line
   * item — hosted Checkout gets one from `productName`, this path gets nothing — so without it
   * the provider's payments list is a column of bare amounts and triaging a guest's phone call
   * means opening metadata.
   */
  description?: string;
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
 * A verified `charge.refunded` event (#616), normalized off the provider's shape.
 *
 * **`amountRefundedCents` is CUMULATIVE**, not the delta of the refund that triggered this
 * event — that is Stripe's `charge.amount_refunded`, and it is the same shape
 * `markPaymentRefunded(id, refundedTotalCents)` already took. Keeping it cumulative is what
 * makes redelivery and a second partial refund the identical write.
 */
export interface RefundRecorded {
  /** The refunded charge's PaymentIntent — how the ledger row is found. */
  paymentIntentId: string;
  /** Total refunded on that charge SO FAR, cents. */
  amountRefundedCents: number;
  currency: string;
}

/**
 * How far a dispute has got, normalized off Stripe's eight-value `Dispute.Status` (issue #723).
 *
 * Four states, not eight, because only four distinct things can happen to Muster's ledger. The
 * mapping lives in the adapter, written against the PINNED SDK's own union
 * (`node_modules/stripe/esm/resources/Disputes.d.ts`: `lost | needs_response | prevented |
 * under_review | warning_closed | warning_needs_response | warning_under_review | won`), so a
 * Stripe change surfaces as a type error in one file rather than as a wrong ledger everywhere.
 *
 * - `inquiry` — the `warning_*` family. A retrieval request, not a chargeback: **no money has
 *   moved.** Worth telling a human about; worth nothing to the ledger.
 * - `live` — a real dispute in flight. Treat the funds as gone while it runs.
 * - `won` — resolved our way, the money came back. Also carries `prevented`.
 * - `lost` — resolved against us, the money is gone for good.
 * - `unknown` — a status the PINNED SDK's union does not contain, which can only happen at
 *   runtime: Stripe adds one and this deploy has not been bumped. **Writes nothing to the
 *   ledger and alerts loudly**, because the honest answer to "did the money move" is that we
 *   cannot tell, and guessing either way is worse than saying so.
 */
export type DisputeState = "inquiry" | "live" | "won" | "lost" | "unknown";

/**
 * A verified `charge.dispute.*` event (issue #723), normalized off the provider's shape.
 *
 * Keyed on the PaymentIntent, exactly like `RefundRecorded` and for the same reason: `Payment`
 * records `stripePaymentIntentId` on both charge paths and has never carried a charge id.
 *
 * **`amountCents` is the DISPUTED amount, which is not always the charge amount** — Stripe's
 * own field docs note it can differ (only part of the order disputed, currency movement). It is
 * carried for the alert text and never for ledger arithmetic; the ledger decision is the state
 * above, not the number.
 */
export interface DisputeUpdated {
  paymentIntentId: string;
  state: DisputeState;
  amountCents: number;
  currency: string;
  /** Cardholder's stated reason (`fraudulent`, `product_not_received`, …) — for the alert. */
  reason: string;
}

/**
 * The verified-webhook event union (12.5, DEC-134; refunds #616; disputes issue #723).
 * `checkout_completed` drives the hosted flows (balance + post-gratuity); `payment_succeeded`
 * drives the inline-Elements booking; `refund_recorded` reconciles a refund back into the
 * ledger — including one the operator issued in the STRIPE DASHBOARD, which Muster could not
 * see at all before; `dispute_updated` does the same job for a chargeback, which is money
 * leaving the account with nobody in Muster having pressed anything.
 */
export type PaymentEvent =
  | { type: "checkout_completed"; data: CheckoutCompleted }
  | { type: "payment_succeeded"; data: PaymentSucceeded }
  | { type: "refund_recorded"; data: RefundRecorded }
  | { type: "dispute_updated"; data: DisputeUpdated };

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
   * The provider's HOSTED RECEIPT url for a settled payment (#679) — a guest-safe page, not a
   * dashboard link, so it can be shown on `/b/<code>`.
   *
   * Separate from `parseEvent` because that method is synchronous and the receipt url hangs off
   * the CHARGE, which a `payment_intent.succeeded` payload carries only as an id. Fetching it
   * needs a round trip, so it is its own call rather than a field on the event.
   *
   * Returns `undefined` when the provider has no receipt for that intent. **Throws on a provider
   * failure** — the caller catches and writes the payment without a receipt link. A receipt is a
   * convenience; the payment row is not.
   */
  getReceiptUrl(paymentIntentId: string): Promise<string | undefined>;
  /**
   * Verify the webhook signature and normalize the event (12.5, DEC-134). Returns the
   * discriminated union for a `checkout.session.completed` or `payment_intent.succeeded`
   * event, or **`null`** for any other (verified) event type the caller should acknowledge
   * and ignore. **Throws on an invalid/absent signature** — the port owns verification so
   * the fake can synthesize events in tests without a real Stripe signature.
   */
  parseEvent(rawBody: string, signature: string): PaymentEvent | null;
}
