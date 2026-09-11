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
  type PaymentSucceeded,
  type RefundInput,
} from "../ports/payment.js";

/**
 * Every NAMED member of a Stripe string enum, with the open-ended one removed.
 *
 * The SDK's string unions end in `OtherString` — `string & Record<never, never>`
 * (`shared.d.ts:160`) — which exists so a status Stripe invents next year does not break
 * consumers at the type level. It also means the union is **permanently open**, so the
 * `const x: never = status` exhaustiveness idiom stops compiling the moment it appears: in a
 * `default` branch `status` narrows to `OtherString`, not to `never`.
 *
 * This filter keeps the guarantee that idiom was for. `string extends 'won'` is false, so a
 * literal survives; `string extends string & Record<never, never>` is true, so the open member
 * maps to `never` and drops out. What remains is exactly the set Stripe has *named*, which is
 * the set a human can be expected to have an opinion about.
 */
type NamedOnly<T> = T extends string ? (string extends T ? never : T) : never;

/** Fails to compile unless `T` is `never`. The error names the offending literal. */
type AssertNever<T extends never> = T;

/** The dispute statuses this mapping handles by name. Paired with the switch below. */
type HandledDisputeStatus =
  | "warning_needs_response"
  | "warning_under_review"
  | "warning_closed"
  | "needs_response"
  | "under_review"
  | "won"
  | "prevented"
  | "lost";

/**
 * **The compile-time half of issue #723's guard, rebuilt for an open union.**
 *
 * If Stripe adds a named dispute status and the SDK bump brings it in, this line fails
 * `typecheck` with the new literal in the message — one file, at build time — instead of the
 * ledger quietly mis-stating whether money is in the account. That is the guarantee
 * `countsAsPaid` was wrongly assumed to have before #723.
 *
 * It replaced `const unreachable: never = status`, which did the same job until 22.6.x added
 * `OtherString` to the union and made it impossible. **The bump is what surfaced that**, which is
 * the tripwire in the constructor below earning its keep on its first outing: without the stated
 * `apiVersion` the upgrade would have been green, and this guard would have been silently
 * reduced to its runtime half.
 */
type _AllNamedDisputeStatusesHandled = AssertNever<
  Exclude<NamedOnly<Stripe.Dispute.Status>, HandledDisputeStatus>
>;

/**
 * **Proof that the line above bites**, and it is permanent rather than a one-off I ran once.
 *
 * `Hypothetical` is the union Stripe would ship if it added a status tomorrow: today's members,
 * the open member, and one new name. The assertion must reject it — so `@ts-expect-error` passes
 * only while the guard works, and the day it stops working TypeScript reports the directive as
 * unused and `typecheck` fails. A guard nobody has watched fire may be asserting nothing; this is
 * how it stays watched without deleting and restoring the real one to fake a failure.
 *
 * The open member is written out rather than imported: `OtherString` is internal to the SDK's
 * `shared.d.ts` and not re-exported through the `Stripe` namespace.
 */
type Hypothetical = HandledDisputeStatus | "warning_new_network_thing" | (string & Record<never, never>);
// @ts-expect-error — an unhandled NAMED status must fail this assertion
type _GuardBites = AssertNever<Exclude<NamedOnly<Hypothetical>, HandledDisputeStatus>>;

/**
 * Stripe's eight named dispute statuses → the four Muster's ledger can act on (issue #723).
 *
 * **A map rather than a switch, and the type annotation is the whole reason.**
 * `Record<HandledDisputeStatus, DisputeState>` is checked in both directions: omit a member and
 * it is a missing-property error, add one Stripe does not have and it is an excess-property
 * error. So this object IS the coverage — the list of statuses we handle and the handling of them
 * cannot be edited apart.
 *
 * That coupling is why the switch went. A switch plus a separate `HandledDisputeStatus` list let
 * the two drift: a future bump that failed `_AllNamedDisputeStatusesHandled` could be made green
 * by adding the new literal to the list alone, leaving no `case` for it and sending a real
 * chargeback silently to `unknown` (`@code-review`, and it reproduced this). The old
 * `const unreachable: never = status` never had that hole, because it keyed off the switch's own
 * narrowing — so replacing it with a hand-kept list was a downgrade until this map closed it.
 *
 * The `warning_*` family is a retrieval request: the card network is asking a question and no
 * funds have been withdrawn. Mapping those to `live` would zero out revenue on a booking that
 * was never actually charged back, which is a false alarm the operator would learn to ignore —
 * and the alarms here are the whole feature.
 */
const DISPUTE_STATE: Readonly<Record<HandledDisputeStatus, DisputeState>> = {
  warning_needs_response: "inquiry",
  warning_under_review: "inquiry",
  warning_closed: "inquiry",
  needs_response: "live",
  under_review: "live",
  won: "won",
  prevented: "won",
  lost: "lost",
};

function disputeState(status: Stripe.Dispute.Status): DisputeState {
  // **The RUN-time half, and the exhaustive switch alone did not have it.** The union is a claim
  // the pinned SDK makes at build time about a string that arrives over the wire months later:
  // Stripe adds a status, this deploy has not been bumped, and nothing matches. The old code
  // returned `undefined` — which is not a `DisputeState`, wrote nothing to the ledger, and fell
  // through to the alert branch announcing "DISPUTE OPENED".
  //
  // That is the defect issue #723 was filed for: a compile-time guarantee assumed to cover a
  // runtime path. `unknown` writes nothing, which is the right default for a state we cannot
  // interpret, and says so out loud.
  //
  // The lookup widens deliberately. `status` may be `OtherString` — a string Stripe invented
  // after this deploy — so the index signature has to admit a miss; the real key/value types stay
  // enforced on the literal above, where they are checkable.
  //
  // `Object.hasOwn` rather than a bare index, and it is not ceremony (`/security-review`). A plain
  // object literal inherits from `Object.prototype`, so `DISPUTE_STATE["__proto__"]` is an object
  // and `DISPUTE_STATE["toString"]` is a function — both truthy, so `?? "unknown"` would not fire
  // and a non-`DisputeState` would escape. Downstream that is not a crash but something worse:
  // `DISPUTE_LEDGER_WRITE[state]` misses, nothing is written, and the operator is texted the
  // generic "DISPUTE OPENED" instead of the line saying we got a status we cannot read. The
  // `switch` this replaced had no such hole, so without this guard the rewrite would have been a
  // quiet regression on the one path that exists to be loud.
  if (!Object.hasOwn(DISPUTE_STATE, status)) return "unknown";
  return (DISPUTE_STATE as Record<string, DisputeState>)[status] ?? "unknown";
}

export class StripePaymentPort implements PaymentPort {
  readonly #stripe: Stripe;
  readonly #webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    // **This literal and the `stripe` range in `package.json` change together, or not at all.**
    //
    // Omitting `apiVersion` does NOT mean "the account's default" — it means the version compiled
    // into whichever SDK is installed (`node_modules/stripe/esm/apiVersion.d.ts`), sent as the
    // `Stripe-Version` header on every request. So before this line, upgrading the library for an
    // unrelated reason — a security patch, say — silently moved the API version we talk to, with
    // no diff anywhere to point at as the cause.
    //
    // Stating it makes that upgrade FAIL TO BUILD. `apiVersion?: LatestApiVersion` is
    // `typeof ApiVersion` (`lib.d.ts:11,27`), a string-literal type, so a bump that moves the
    // SDK's constant cannot typecheck until someone edits this line — and to edit it they have to
    // read what changed between the two API versions. **That is the entire point: it is not a
    // test of Stripe, it is a note to whoever bumps the library that they cannot walk past.**
    //
    // No runtime test guards it, deliberately. After a bump the SDK's default equals this literal,
    // so `expect(ours).toBe(Stripe.API_VERSION)` is constant-vs-constant and stays green if the
    // argument below is deleted. The typechecker fires exactly when they diverge, which is the
    // only case that matters; a runtime assertion here would be coverage theatre.
    this.#stripe = new Stripe(secretKey, {
      typescript: true,
      apiVersion: "2026-08-26.dahlia",
    });
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
      // #679. `description` is the only human-readable field on a raw PaymentIntent — hosted
      // Checkout gets a line item, this path does not. `receipt_email` is what makes Stripe
      // send the guest a receipt at all; in live mode it sends regardless of the account's
      // email settings, so passing it IS the decision to send one.
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.receiptEmail !== undefined ? { receipt_email: input.receiptEmail } : {}),
    });
    if (!intent.client_secret) throw new Error("Stripe payment intent returned no client_secret");
    return { clientSecret: intent.client_secret, paymentIntentId: intent.id };
  }

  /**
   * Read a PaymentIntent back and report it ONLY if Stripe says it succeeded (issue #827).
   *
   * `status === "succeeded"` is the gate. The success page hands us an id out of a URL, so this
   * is the step that makes the redirect meaningless as evidence: an unknown id, a failed intent
   * or an unpaid one all resolve to `null` and book nothing. A retrieve failure is `null` too —
   * unable-to-verify is not the same as verified, and the webhook is still coming.
   */
  async getSucceededPaymentIntent(paymentIntentId: string): Promise<PaymentSucceeded | null> {
    try {
      const pi = await this.#stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== "succeeded") return null;
      return {
        paymentIntentId: pi.id,
        amountReceivedCents: pi.amount_received,
        currency: pi.currency,
        metadata: pi.metadata ?? {},
      };
    } catch {
      return null;
    }
  }

  async getReceiptUrl(paymentIntentId: string): Promise<string | undefined> {
    // `latest_charge` comes back as a bare id unless expanded, and the receipt url lives on the
    // charge — so this is one retrieve with an expand rather than two round trips.
    const intent = await this.#stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge = intent.latest_charge;
    // A string here means the expand didn't take (or the intent has no charge yet). Return
    // nothing rather than a charge id masquerading as a url.
    if (!charge || typeof charge === "string") return undefined;
    return charge.receipt_url ?? undefined;
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
    if (event.type === "payment_intent.payment_failed") {
      // A declined card (14.8, criterion 11). Parsed and named so the spine can ignore it on
      // purpose; returning `null` here would ack it too, but as an unrecognised event, and
      // "we decided to do nothing" would be indistinguishable from "we have never heard of this".
      const pi = event.data.object as Stripe.PaymentIntent;
      const code = pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code;
      return {
        type: "payment_failed",
        data: {
          paymentIntentId: pi.id,
          ...(code !== undefined && code !== null ? { declineCode: code } : {}),
        },
      };
    }
    return null;
  }
}
