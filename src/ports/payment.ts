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
  /**
   * **Idempotency key for this create (15.11).** The same key returns the same PaymentIntent
   * rather than a second one — Stripe's own mechanism, and the only thing that can tell two
   * requests apart as "the same checkout", because nothing in the payload says so.
   *
   * **It must change per ATTEMPT, not per row.** Keyed on the row id alone it would be actively
   * wrong: the row id is constant for the life of a checkout, so a deliberate re-mint would get
   * the dead intent back, or a 400 on a changed parameter. The caller keys it on the row id plus
   * the attempt ordinal, which dedupes two concurrent submits while leaving a later retry free to
   * mint.
   *
   * Required rather than optional, on 15.6's argument about metadata: with one caller, "I sent
   * nothing" belongs written at the call site rather than inferred from an absent key.
   *
   * Never derived from the holder token — that is a possession credential, and a key travels to
   * the provider's logs.
   */
  idempotencyKey: string;
  /**
   * Opaque key/value carried through Stripe back to the webhook.
   *
   * **Optional, and the booking charge sends none (15.6).** It used to be required and used to
   * carry the frozen slot and money, which the webhook then booked from — forbidden by DEC-164
   * and by SPEC 2.8's negative list, and four of those keys were the customer's personal data
   * sitting in a third party's dashboard for no reader. The reservation row holds all of it.
   *
   * Nothing reads this on the booking path any more, which sends `{}`. Still required rather
   * than optional, so "I sent nothing" is written down at the call site instead of inferred from
   * an absent key — and so the hosted session paths, which do carry metadata, keep their shape.
   */
  metadata: Record<string, string>;
}

/**
 * A PaymentIntent's state, normalized away from the provider's vocabulary (15.8).
 *
 * Three members, because the caller only ever asks three questions: can I still raise this and
 * hand it back to the customer, has it already taken the money, or do I not know.
 *
 * `"unknown"` covers a status this build has not been taught, a read that threw, and an intent the
 * provider has never heard of. All three mean the same thing to a retry: do not reuse it.
 */
export type PaymentIntentState = "reusable" | "settled" | "unknown";

/**
 * Why an intent is being cancelled (15.10) — Stripe's own enum, narrowed to the two Muster means.
 *
 * Its full set is `duplicate | fraudulent | requested_by_customer | abandoned`. The other two
 * describe a judgment nobody here is making: we do not decide a charge was fraudulent, and a
 * customer who walked away from a card form did not request anything.
 *
 * - `abandoned` — a checkout minted a replacement and this one was left behind.
 * - `duplicate` — the row is booked by a different intent, so this one is a second charge for one
 *   sale waiting to happen.
 */
export type CancelReason = "abandoned" | "duplicate";

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
 * A verified `payment_intent.payment_failed` event (14.8, criterion 11) — a declined card.
 *
 * Carried as a NAMED member rather than left to fall out of `parseEvent` as `null`, because
 * "ignored on purpose" and "unrecognised" must not be the same signal. The handler does nothing
 * with it (see the spine), and `declineCode` exists so the day somebody does want to act on one,
 * the reason is already in hand rather than requiring a port change first.
 */
export interface PaymentFailed {
  paymentIntentId: string;
  /** Provider's decline reason (`card_declined`, `insufficient_funds`, …), when it sends one. */
  declineCode?: string;
}

/**
 * A verified `payment_intent.canceled` event (15.10), normalized off the provider's shape.
 *
 * Named for the same reason `PaymentFailed` is: **ignored on purpose and unrecognised must not be
 * the same signal.** Every cancel Muster performs is one it already knows about — the port call
 * returned before this event was written — so the handler acks it and does nothing. The member
 * exists so that a cancel Muster did NOT perform, one an operator made in the dashboard, is a thing
 * the code has a word for the day somebody wants to act on it.
 *
 * **Subscribing the endpoint to this event is optional.** Nothing in 15.10 needs it to arrive; the
 * cancel is an API call read synchronously. It buys visibility of dashboard-side cancels.
 */
export interface PaymentCanceled {
  paymentIntentId: string;
  /** Stripe's `cancellation_reason`, when it sends one. Includes reasons we never send. */
  reason?: string;
}

/**
 * A verified `payment_intent.processing` event (15.12), normalized off the provider's shape.
 *
 * **A delayed payment method is settling.** The customer has authorized; the money arrives days
 * later, and `payment_intent.succeeded` follows then. Named for the reason its two neighbours are —
 * ignored-on-purpose and unrecognised must not be the same signal — but unlike them it is **not**
 * ignored in silence: a decline leaves a customer still at the till, and a cancel is something we
 * did ourselves, while this is a booking in flight that no screen in Muster shows.
 *
 * **Its arrival is a fact about the ACCOUNT, not about the booking.** `/book` sends
 * `automatic_payment_methods: { enabled: true }`, which delegates method selection to the Stripe
 * Dashboard, so this event can only appear once somebody enables a delayed method there — a change
 * with no diff in this repository. Reading the account on 2026-09-19 showed every delayed method
 * off; the day that changes, this is how anyone finds out.
 */
export interface PaymentProcessing {
  paymentIntentId: string;
}

/**
 * The verified-webhook event union (12.5, DEC-134; refunds #616; disputes issue #723;
 * declines 14.8). `checkout_completed` drives the hosted flows (balance + post-gratuity);
 * `payment_succeeded` drives the inline-Elements booking; `refund_recorded` reconciles a refund
 * back into the ledger — including one the operator issued in the STRIPE DASHBOARD, which Muster
 * could not see at all before; `dispute_updated` does the same job for a chargeback, which is
 * money leaving the account with nobody in Muster having pressed anything; `payment_failed` is
 * acked and deliberately does nothing.
 */
export type PaymentEvent = {
  /**
   * Stripe's own id for this delivery, `evt_…` (15.13).
   *
   * **It exists to join two records of one failure.** The route turns any throw after a valid
   * signature into a 500 so Stripe retries; Stripe's Workbench then shows a delivery with this id,
   * and Vercel shows a failure line. Before this field the two could not be matched to each other,
   * and `parseEvent` had been reading `event.id` off the verified event and discarding it.
   *
   * **`stripeEventId`, never `eventId`.** `eventId` means the departure `Event` throughout the
   * reservations code, including inside the functions that handle these. Two things named alike in
   * one file is how the wrong one gets read.
   *
   * On the envelope rather than on each member's `data`, because it describes the delivery and not
   * the payment. `PaymentSucceeded` deliberately does NOT carry one: `/book/success` reaches the
   * same handler through `confirmBookingByPaymentIntent`, which synthesizes its charge from a
   * provider read with no event behind it, so a field there would be real on one path and invented
   * on the other.
   */
  stripeEventId: string;
} & (
  | { type: "checkout_completed"; data: CheckoutCompleted }
  | { type: "payment_succeeded"; data: PaymentSucceeded }
  | { type: "payment_failed"; data: PaymentFailed }
  | { type: "payment_canceled"; data: PaymentCanceled }
  | { type: "payment_processing"; data: PaymentProcessing }
  | { type: "refund_recorded"; data: RefundRecorded }
  | { type: "dispute_updated"; data: DisputeUpdated }
);

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
   * Read a PaymentIntent back from the provider, or `null` if it is unknown or has NOT
   * succeeded (issue #827).
   *
   * **The redirect is not proof of payment.** Stripe appends `payment_intent` and
   * `redirect_status` to the `return_url`, and both are URL text a browser can invent. The
   * success page confirms a booking, so it must ask the provider what actually happened rather
   * than believe the address bar. A forged or unpaid id resolves to `null` and books nothing.
   */
  getSucceededPaymentIntent(paymentIntentId: string): Promise<PaymentSucceeded | null>;
  /**
   * What state is this PaymentIntent in, normalized (15.8)? Read before a retry decides whether to
   * reuse the intent it already minted or start a new one.
   *
   * **`"unknown"` is a real member, not a fallback nobody hits.** A provider that returns a status
   * this build has never heard of, or a read that throws, both resolve here — and the caller mints
   * fresh rather than guessing. Reusing an intent we cannot describe is how one charge becomes
   * two.
   */
  getPaymentIntentState(paymentIntentId: string): Promise<PaymentIntentState>;
  /**
   * Raise or lower the amount on an intent still awaiting payment (15.8).
   *
   * Stripe endorses the shape: *"If the checkout process is interrupted and resumes later, attempt
   * to reuse the same PaymentIntent instead of creating a new one"*, and *"you might need to update
   * the amount when they start the checkout process again"* (`/payments/payment-intents`).
   *
   * **Its documentation contradicts itself on the case that matters**, which is a card that was
   * declined: one page permits updates while awaiting payment, another says the amount generally
   * cannot be increased after confirmation, and a declined intent is both at once. Verified by hand
   * in the sandbox on 2026-09-15 — a $10 intent, declined, raised to $20, accepted. The fake below
   * encodes that answer, so nothing in the suite would notice if Stripe tightened it; issue #1021
   * is the round-trip test that would.
   *
   * **Returns the client secret**, because the browser needs one to confirm and Muster does not
   * store it — it is a bearer credential for that charge, and the provider hands it back on the
   * update anyway. Keeping it out of our database is deliberate.
   *
   * **Throws** if the provider refuses — the customer may have completed the first confirm in
   * another tab between the state read and this call, which is a race no read can close.
   */
  updatePaymentIntentAmount(
    paymentIntentId: string,
    amountCents: number,
  ): Promise<{ clientSecret: string }>;
  /**
   * Retire an intent so nobody can pay it (15.10).
   *
   * Stripe: *"You can cancel a PaymentIntent object when it's in one of these statuses:
   * requires_payment_method, requires_capture, requires_confirmation, requires_action or, in rare
   * cases, processing"*, and *"after it's canceled, no additional charges are made by the
   * PaymentIntent and any operations on the PaymentIntent fail with an error"*.
   *
   * **Every caller treats this as best-effort and none may let it fail their work.** The states it
   * refuses are ordinary here, not exceptional: an already-cancelled sibling on a webhook
   * redelivery, an intent that succeeded between our read and this call, an id the provider never
   * knew. A 500 from any of those would make Stripe retry a sale that has already completed.
   *
   * **Throws** when the provider refuses, matching `refund` and `updatePaymentIntentAmount`. The
   * callers wrap it; the port does not pretend the failure did not happen.
   */
  cancelPaymentIntent(paymentIntentId: string, reason: CancelReason): Promise<void>;
  /**
   * Verify the webhook signature and normalize the event (12.5, DEC-134). Returns the
   * discriminated union for a `checkout.session.completed` or `payment_intent.succeeded`
   * event, or **`null`** for any other (verified) event type the caller should acknowledge
   * and ignore. **Throws on an invalid/absent signature** — the port owns verification so
   * the fake can synthesize events in tests without a real Stripe signature.
   */
  parseEvent(rawBody: string, signature: string): PaymentEvent | null;
  /**
   * Every webhook endpoint registered on the account (15.16, issue #984).
   *
   * **This exists because the provider can tell us a delivery FAILED and cannot tell us deliveries
   * STOPPED.** Stripe emails on repeated failures and retries for three days — so a rotated secret
   * or a 500ing handler announces itself. An endpoint that was deleted, disabled, or repointed at
   * a previous deploy URL produces no failed delivery to alert on, because no delivery is
   * attempted. Nothing on Stripe's side closes that gap below its Advanced support tier.
   *
   * **`livemode` is deliberately not on the returned shape.** A list request returns only
   * endpoints matching the calling key's own mode, so it could never disagree with the key that
   * fetched it — a field for a case the API cannot produce.
   *
   * **Throws** on a provider failure. The caller is a cron leg and treats a throw as "unknown",
   * not as "broken": alerting on a transient Stripe read would page every admin for Stripe's
   * outage rather than ours.
   */
  listWebhookEndpoints(): Promise<readonly WebhookEndpointInfo[]>;
}

/**
 * One registered webhook endpoint, normalized — nothing Stripe-shaped crosses the port (15.16).
 *
 * Field sources, from `/api/webhook_endpoints/object` read 2026-09-21: `status` is *"The status of
 * the webhook. It can be `enabled` or `disabled`"*; `enabled_events` is *"The list of events to
 * enable for this endpoint. `['*']` indicates that all events are enabled, except those that
 * require explicit selection."* That `["*"]` form is the common real configuration and a reader of
 * `enabledEvents` must treat it as covering everything rather than as a literal event name.
 */
export interface WebhookEndpointInfo {
  url: string;
  enabled: boolean;
  enabledEvents: readonly string[];
}
