/**
 * Live Stripe adapter for the PaymentPort (DEC-107) — lifted from the sibling `sailbook`
 * project (`src/lib/stripe.ts`, `api/webhooks/stripe/route.ts`) into strict TS behind the
 * port boundary. Hosted Checkout (card), raw PaymentIntents for the inline-Elements
 * checkout (12.5, DEC-134), signature-verified webhook, and a keyed-idempotent
 * `refund` for the ONE automatic case — the DEC-109 residual-race loser (DEC-107 amended,
 * 12.1b). All other refunds stay manual in the Stripe dashboard.
 *
 * Secrets come from env (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), read at the route
 * and passed to the constructor — the adapter itself is env-agnostic + unit-constructable.
 */
import Stripe from "stripe";
import {
  PaymentSignatureError,
  type CheckoutSession,
  type CreateCheckoutInput,
  type CreatePaymentIntentInput,
  type DisputeState,
  type PaymentEvent,
  type PaymentPort,
  type RefundInput,
} from "../ports/payment.js";

/**
 * Stripe's eight dispute statuses → the four Muster's ledger can act on (issue #723).
 *
 * **Exhaustive on purpose, with no `default`.** The parameter is the SDK's own
 * `Stripe.Dispute.Status` union, so when Stripe adds a ninth status the SDK bump fails
 * `typecheck` right here — one file, at build time — instead of silently taking a `default`
 * branch and mis-stating whether money is in the account. That is the compile-time guarantee
 * `countsAsPaid` was wrongly assumed to have before this issue.
 *
 * The `warning_*` family is a retrieval request: the card network is asking a question and no
 * funds have been withdrawn. Mapping those to `live` would zero out revenue on a booking that
 * was never actually charged back, which is a false alarm the operator would learn to ignore —
 * and the alarms here are the whole feature.
 */
function disputeState(status: Stripe.Dispute.Status): DisputeState {
  switch (status) {
    case "warning_needs_response":
    case "warning_under_review":
    case "warning_closed":
      return "inquiry";
    case "needs_response":
    case "under_review":
      return "live";
    case "won":
    case "prevented":
      return "won";
    case "lost":
      return "lost";
    default: {
      // **Both halves are needed, and an earlier cut had only the first.**
      //
      // The `never` assignment is the COMPILE-time half: widen `Stripe.Dispute.Status` by
      // bumping the SDK and `status` stops being `never` here, so `typecheck` fails in this one
      // file rather than the ledger quietly mis-stating whether money is in the account.
      //
      // The `return` is the RUN-time half, and the exhaustive switch alone did not have it. The
      // union is a claim the pinned SDK makes at build time about a string that arrives over the
      // wire months later: Stripe adds a status, this deploy has not been bumped, and the switch
      // matched nothing. It returned `undefined` — which is not a `DisputeState`, wrote nothing
      // to the ledger, and fell through to the alert branch announcing "DISPUTE OPENED".
      //
      // That is the same shape as the defect this whole change exists to fix (issue #723): a
      // compile-time guarantee assumed to cover a runtime path. `unknown` writes nothing, which
      // is the right default for a state we cannot interpret, and says so out loud.
      const unreachable: never = status;
      void unreachable;
      return "unknown";
    }
  }
}

export class StripePaymentPort implements PaymentPort {
  readonly #stripe: Stripe;
  readonly #webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    // apiVersion omitted → the SDK's pinned default (fine for a single test/live account).
    this.#stripe = new Stripe(secretKey, { typescript: true });
    this.#webhookSecret = webhookSecret;
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    // CRITICAL (DEC-134 double-write guard): NEVER set `payment_intent_data.metadata` here.
    // The metadata lives on the SESSION only, so the PaymentIntent underlying a hosted
    // checkout stays metadata-less and the `payment_intent.succeeded` webhook handler
    // (which processes only `purpose`-carrying intents) acks-and-ignores it — one charge,
    // one booking write, never two.
    const session = await this.#stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: input.currency,
            product_data: { name: input.productName },
            unit_amount: input.amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
    });
    if (!session.url) throw new Error("Stripe checkout session returned no url");
    return { id: session.id, url: session.url };
  }

  async refund(input: RefundInput): Promise<{ refundId: string }> {
    // Keyed-idempotent (DEC-107 amended): Stripe dedupes on `idempotencyKey`, so a
    // re-delivered losing-session webhook re-calls with `refund_${sessionId}` and gets the
    // SAME refund back — never a second one. Omit `amount` for a full refund.
    const refund = await this.#stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        ...(input.amountCents !== undefined ? { amount: input.amountCents } : {}),
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { refundId: refund.id };
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    // The inline-Elements charge (12.5, DEC-134). `automatic_payment_methods` mirrors the
    // deferred `Elements` mount client-side; the metadata (incl. `purpose`) is what the
    // `payment_intent.succeeded` webhook books from.
    const intent = await this.#stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency,
      metadata: input.metadata,
      automatic_payment_methods: { enabled: true },
    });
    if (!intent.client_secret) throw new Error("Stripe payment intent returned no client_secret");
    return { clientSecret: intent.client_secret, paymentIntentId: intent.id };
  }

  parseEvent(rawBody: string, signature: string): PaymentEvent | null {
    // Verify + parse; a bad/absent signature is a client error (400), distinct from a
    // downstream infra failure (500) — so re-throw it as our typed signature error.
    let event: Stripe.Event;
    try {
      event = this.#stripe.webhooks.constructEvent(rawBody, signature, this.#webhookSecret);
    } catch (e) {
      throw new PaymentSignatureError(e instanceof Error ? e.message : "signature verification failed");
    }
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      const paymentIntentId =
        typeof s.payment_intent === "string" ? s.payment_intent : undefined;
      return {
        type: "checkout_completed",
        data: {
          sessionId: s.id,
          ...(paymentIntentId !== undefined ? { paymentIntentId } : {}),
          amountTotalCents: s.amount_total ?? 0,
          currency: s.currency ?? "usd",
          metadata: (s.metadata ?? {}) as Record<string, string>,
        },
      };
    }
    if (event.type === "charge.refunded") {
      // #616. Fires for EVERY refund on the charge, including one the operator issued by hand
      // in the Stripe dashboard — the case Muster was blind to. `amount_refunded` is the
      // charge's cumulative total, not this refund's delta, which is why the handler can write
      // it straight through `markPaymentRefunded` and be idempotent on redelivery.
      //
      // Keyed on the PaymentIntent rather than the charge: `Payment` records
      // `stripePaymentIntentId` on both the hosted and the Elements path (DEC-134) and has
      // never carried a charge id.
      const c = event.data.object as Stripe.Charge;
      const paymentIntentId =
        typeof c.payment_intent === "string" ? c.payment_intent : undefined;
      // No PaymentIntent on the charge means nothing to reconcile against. Ack and ignore
      // rather than invent a lookup key — the handler's unknown-intent alert would fire on a
      // fabricated one and send the operator hunting for a row that was never written.
      if (paymentIntentId === undefined) return null;
      return {
        type: "refund_recorded",
        data: {
          paymentIntentId,
          amountRefundedCents: c.amount_refunded ?? 0,
          currency: c.currency ?? "usd",
        },
      };
    }
    if (
      event.type === "charge.dispute.created" ||
      event.type === "charge.dispute.updated" ||
      event.type === "charge.dispute.closed"
    ) {
      // issue #723. All THREE map through one branch on purpose: the ledger cares about the
      // dispute's `status`, not about which lifecycle event carried it. That makes the handler
      // idempotent by construction — a redelivery, or `updated` firing twice with no change,
      // computes the same state and writes the same row.
      //
      // Subscribing to `updated` is not optional. A dispute can OPEN as a `warning_*` inquiry
      // (no funds moved) and later become a real one; that transition arrives as `updated`, and
      // without it Muster would record the inquiry and never learn the money actually left.
      const d = event.data.object as Stripe.Dispute;
      // Same posture as `charge.refunded`: no PaymentIntent means no key to reconcile against.
      // Ack and ignore rather than invent one — a fabricated key would fire the handler's
      // unknown-payment alert and send the operator hunting for a row nobody ever wrote.
      const paymentIntentId =
        typeof d.payment_intent === "string" ? d.payment_intent : undefined;
      if (paymentIntentId === undefined) return null;
      return {
        type: "dispute_updated",
        data: {
          paymentIntentId,
          state: disputeState(d.status),
          amountCents: d.amount,
          currency: d.currency,
          reason: d.reason,
        },
      };
    }
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      return {
        type: "payment_succeeded",
        data: {
          paymentIntentId: pi.id,
          amountReceivedCents: pi.amount_received ?? 0,
          currency: pi.currency ?? "usd",
          metadata: (pi.metadata ?? {}) as Record<string, string>,
        },
      };
    }
    return null;
  }
}
