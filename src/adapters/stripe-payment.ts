/**
 * Live Stripe adapter for the PaymentPort (DEC-107) — lifted from the sibling `sailbook`
 * project (`src/lib/stripe.ts`, `api/webhooks/stripe/route.ts`) into strict TS behind the
 * port boundary. Hosted Checkout (card), signature-verified webhook. **No refund** —
 * refunds are always manual in the Stripe dashboard.
 *
 * Secrets come from env (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), read at the route
 * and passed to the constructor — the adapter itself is env-agnostic + unit-constructable.
 */
import Stripe from "stripe";
import type {
  CheckoutCompleted,
  CheckoutSession,
  CreateCheckoutInput,
  PaymentPort,
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

  parseCheckoutCompleted(rawBody: string, signature: string): CheckoutCompleted | null {
    // Throws on a bad/absent signature (the DEC-107 verification boundary).
    const event = this.#stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.#webhookSecret,
    );
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
