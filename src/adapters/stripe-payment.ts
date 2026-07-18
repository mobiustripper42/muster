/**
 * Live Stripe adapter for the PaymentPort (DEC-107) — lifted from the sibling `sailbook`
 * project (`src/lib/stripe.ts`, `api/webhooks/stripe/route.ts`) into strict TS behind the
 * port boundary. Hosted Checkout (card), signature-verified webhook, and a keyed-idempotent
 * `refund` for the ONE automatic case — the DEC-109 residual-race loser (DEC-107 amended,
 * 12.1b). All other refunds stay manual in the Stripe dashboard.
 *
 * Secrets come from env (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), read at the route
 * and passed to the constructor — the adapter itself is env-agnostic + unit-constructable.
 */
import Stripe from "stripe";
import {
  PaymentSignatureError,
  type CheckoutCompleted,
  type CheckoutSession,
  type CreateCheckoutInput,
  type PaymentPort,
  type RefundInput,
} from "../ports/payment.js";

export class StripePaymentPort implements PaymentPort {
  readonly #stripe: Stripe;
  readonly #webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    // apiVersion omitted → the SDK's pinned default (fine for a single test/live account).
    this.#stripe = new Stripe(secretKey, { typescript: true });
    this.#webhookSecret = webhookSecret;
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
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

  parseCheckoutCompleted(rawBody: string, signature: string): CheckoutCompleted | null {
    // Verify + parse; a bad/absent signature is a client error (400), distinct from a
    // downstream infra failure (500) — so re-throw it as our typed signature error.
    let event: Stripe.Event;
    try {
      event = this.#stripe.webhooks.constructEvent(rawBody, signature, this.#webhookSecret);
    } catch (e) {
      throw new PaymentSignatureError(e instanceof Error ? e.message : "signature verification failed");
    }
    if (event.type !== "checkout.session.completed") return null;
    const s = event.data.object as Stripe.Checkout.Session;
    const paymentIntentId =
      typeof s.payment_intent === "string" ? s.payment_intent : undefined;
    return {
      sessionId: s.id,
      ...(paymentIntentId !== undefined ? { paymentIntentId } : {}),
      amountTotalCents: s.amount_total ?? 0,
      currency: s.currency ?? "usd",
      metadata: (s.metadata ?? {}) as Record<string, string>,
    };
  }
}
