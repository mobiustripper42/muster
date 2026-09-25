/**
 * `StripePaymentPort` against the REAL Stripe sandbox — the network half of the adapter.
 *
 *   npm run test:stripe
 *
 * **Why this exists.** Every other layer of the suite talks to `FakePaymentPort`, which is one
 * developer's reading of Stripe's documentation. Twice that reading and Stripe disagreed and the
 * suite stayed green:
 *
 *  - **15.11** computed an idempotency key, put it on the port type, threaded it to the adapter —
 *    and never passed it to Stripe. The fake honoured it; production dropped it.
 *  - **15.6** deleted the charge's metadata and the `purpose` gate that relied on it, and only
 *    `@code-review` reading the diff noticed that the bare PaymentIntent under every hosted balance
 *    payment would now page every admin with "REFUND MANUALLY" (commit 298907a5, issue #1021).
 *
 * `stripe-payment.test.ts` covers the pure half, `parseEvent`, with locally signed payloads. This
 * covers everything that is a network call. Two mechanisms, each suiting its half.
 *
 * **What it cannot cover, by Stripe's design:** the browser. The Payment Element blocks automation
 * (`docs.stripe.com/automated-testing`), so the card form and 3DS stay a hand test. Also not here:
 * which events a deployed endpoint is subscribed to, refunds, disputes, and the Postgres adapter
 * (the flip itself is covered by the repository contract suite). The round trip's reservation lives
 * in an in-memory repository and is gone when the run ends; only the Stripe objects persist.
 *
 * **The raw SDK is used only where the port has no method**: confirming a payment (the customer's
 * browser does that in production) and reading events (Stripe's own record of what it received).
 * Everything the APP runs goes through the port. Adding an events method to production code so a
 * test could read it would be the tail wagging the dog.
 *
 * **Not in `npm test` or `verify`**: the default include is `*.test.ts` and this is `*.sandbox.ts`.
 * It needs the network, it is rate-limited, and every run leaves objects in the sandbox account —
 * two paid test charges (one $275.70 booking, one $50 bare intent) and two cancelled $1 intents.
 * `vitest.sandbox.config.ts` runs it. Folded in from the standalone `db:stripe:cancel` script.
 *
 * **Sandbox only, enforced.** It confirms real PaymentIntents, which moves no money in test mode
 * and would move real money in live mode.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "./in-memory-repository.js";
import { StripePaymentPort } from "./stripe-payment.js";
import type { Offering, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { processBookingWebhook, type WebhookDeps } from "../reservations/booking-webhook.js";
import { createDeparturePaymentIntent } from "../reservations/create-departure-payment-intent.js";

// Vitest loads only `VITE_`-prefixed variables on its own.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

// The key itself is never printed — only whether its prefix is the safe one.
if (secretKey !== "" && !secretKey.startsWith("sk_test_")) {
  throw new Error(
    'Refusing to run: STRIPE_SECRET_KEY does not start with "sk_test_". These tests create, confirm ' +
      "and cancel real PaymentIntents. Point .env.local at your sandbox key.",
  );
}

// ── Fixtures for the round trip ──────────────────────────────────────────────

const SMALL = asId<"VesselId">("v-small");
const OFF = asId<"OfferingId">("off-1");
const DATE = "2026-07-04";
const TIME = "13:30";
const NOW = "2026-07-04T12:00:00.000Z";
const now = () => NOW;

// A manning rule so the booking's shift formation runs clean rather than logging a manning error.
const vessel: Vessel = {
  id: SMALL, name: "Small", coiMaxPax: 6,
  manning: [{ roleTypeId: asId<"RoleTypeId">("captain"), count: 1 }],
};
const offering: Offering = {
  id: OFF, tenantId: asId<"TenantId">("t"), name: "Round Trip Cruise", status: "live",
  vesselIds: [SMALL], locationId: asId<"LocationId">("loc-1"),
  schedule: { seasonStart: "2026-06-01", seasonEnd: "2026-08-31", weekdays: [5], departureTimes: [TIME] },
  basePriceCents: 49900, priceVariations: [], extraGuestPriceCents: 5000,
};

async function seededRepo(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveOffering(offering);
  await repo.saveVessel(vessel);
  // Deposit mode + real rates, so the amount Stripe is asked for is a sum of every money field.
  await repo.setPaymentConfig({ depositMode: "deposit", depositPercent: 25, taxRateBps: 725 }, NOW);
  return repo;
}

function makeDeps(repo: InMemoryRepository, payments: StripePaymentPort) {
  const alert = vi.fn(async (_m: string) => {});
  const deps: WebhookDeps = {
    repo,
    payments,
    now,
    alertPaidButUnbooked: alert,
    sendConfirmation: vi.fn(async () => true),
    notifyCustomerSoldOut: vi.fn(async () => {}),
  };
  return { deps, alert };
}

// ── Stripe helpers — the raw SDK, standing in for the browser and for delivery ─

/**
 * Pay an intent the way the customer's browser would, minus the browser.
 *
 * `return_url` because our intents carry `automatic_payment_methods: { enabled: true }`, and Stripe
 * refuses a server-side confirm on those without one — some enabled method might redirect. A test
 * card never does, so the url is never visited.
 */
async function payWithTestCard(stripe: Stripe, paymentIntentId: string): Promise<void> {
  const paid = await stripe.paymentIntents.confirm(paymentIntentId, {
    payment_method: "pm_card_visa",
    return_url: "https://example.invalid/return",
  });
  expect(paid.status).toBe("succeeded");
}

/**
 * The event of `type` Stripe wrote for this intent, as Stripe wrote it.
 *
 * Polled because event creation is asynchronous to the call that caused it; in practice it is there
 * on the first or second read. Filtered by `created` so the scan stays inside this run's events.
 */
async function eventFor(
  stripe: Stripe,
  type: "payment_intent.created" | "payment_intent.succeeded",
  paymentIntentId: string,
  sinceUnix: number,
): Promise<Stripe.Event> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const page = await stripe.events.list({ type, created: { gte: sinceUnix }, limit: 100 });
    const hit = page.data.find((e) => (e.data.object as Stripe.PaymentIntent).id === paymentIntentId);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Stripe wrote no ${type} for ${paymentIntentId} within 15s`);
}

/**
 * The body and header Stripe would POST, signed with our webhook secret by the SDK's own helper.
 *
 * Signed locally rather than delivered, so `constructEvent` runs for real against a real event
 * body. What that skips is the network hop from Stripe to us — `stripe listen` territory, and the
 * least likely part of this path to regress in code.
 */
function signed(stripe: Stripe, event: Stripe.Event): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret: webhookSecret });
  return { rawBody, signature };
}

/** The message a call threw, or null. The best-effort catches in 15.10 exist because Stripe REFUSES
 *  these calls in ordinary situations, so "it threw" is the assertion, not an accident. */
async function threw(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const sinceNow = () => Math.floor(Date.now() / 1000) - 5;

const haveKeys = secretKey !== "" && webhookSecret !== "";

if (!haveKeys) {
  describe.skip("Stripe sandbox — SKIPPED: no sandbox keys", () => {
    // Inside `describe.skip`, so it never runs; it exists to print what to set (the script's
    // verbose reporter prints skipped names). Same shape as `postgres-repository.test.ts`.
    // eslint-disable-next-line sonarjs/assertions-in-tests, vitest/expect-expect -- never runs
    it("set STRIPE_SECRET_KEY (sk_test_…) and STRIPE_WEBHOOK_SECRET in .env.local, then `npm run test:stripe`", () => {});
  });
} else {
  const stripe = new Stripe(secretKey);
  const payments = new StripePaymentPort(secretKey, webhookSecret);

  describe("Stripe sandbox — the booking round trip (issue #1021)", () => {
    it("a booking paid by card books: the row flips, the Payment is written, the charge carries no metadata", async () => {
      const since = sinceNow();
      const repo = await seededRepo();
      const { deps, alert } = makeDeps(repo, payments);

      const start = await createDeparturePaymentIntent(
        repo,
        payments,
        {
          offeringId: OFF, date: DATE, time: TIME, guestCount: 4, gratuityBps: 2000,
          customerName: "Round Trip", phone: "+12165550148",
          waiverConsentAt: NOW, waiverVersion: "v1",
          // A fresh holder per run: the idempotency key is derived from the row id, which is
          // random, so reruns never collide with an earlier run's intent.
          holderToken: randomUUID().replaceAll("-", ""),
        },
        now,
      );
      if (!start.ok) throw new Error(`checkout refused: ${start.reason}`);

      // What Stripe holds is what 15.6 said it should: nothing in metadata, and a description a
      // person can read in the dashboard.
      const minted = await stripe.paymentIntents.retrieve(start.paymentIntentId);
      expect(minted.metadata).toEqual({});
      expect(minted.description).toBe("Round Trip Cruise — 2026-07-04 13:30 · 4 guests · Round Trip");
      const pending = (await repo.getReservationByPaymentIntentId(start.paymentIntentId))!;
      expect(pending.status).toBe("pending");
      expect(minted.amount).toBe(pending.invoice!.amountDueNowCents);

      await payWithTestCard(stripe, start.paymentIntentId);
      const event = await eventFor(stripe, "payment_intent.succeeded", start.paymentIntentId, since);
      const { rawBody, signature } = signed(stripe, event);

      const result = await processBookingWebhook(deps, rawBody, signature);

      // Booked, and the money off the row.
      expect(result).toEqual({ handled: true, outcome: "booked" });
      const row = (await repo.getReservation(pending.id))!;
      expect(row.status).toBe("booked");
      const [payment, ...more] = await repo.listPaymentsForReservation(pending.id);
      expect(more).toHaveLength(0);
      expect(payment!.amountCents).toBe(pending.invoice!.amountDueNowCents);
      expect(payment!.taxCents).toBe(pending.invoice!.taxCents);
      expect(payment!.gratuityCents).toBe(pending.invoice!.gratuityCents);
      expect(alert).not.toHaveBeenCalled();
    });

    it("a paid intent that is not ours books nothing and pages nobody (the 15.6 regression)", async () => {
      // The shape that broke: the bare PaymentIntent under a hosted balance Checkout Session. No
      // metadata, no pending row. Minted through our adapter so its arguments are the app's.
      const since = sinceNow();
      const repo = await seededRepo();
      const { deps, alert } = makeDeps(repo, payments);

      const bare = await payments.createPaymentIntent({
        amountCents: 5000,
        currency: "usd",
        metadata: {},
        idempotencyKey: `sandbox_bare_${randomUUID()}`,
      });
      await payWithTestCard(stripe, bare.paymentIntentId);
      const event = await eventFor(stripe, "payment_intent.succeeded", bare.paymentIntentId, since);
      const { rawBody, signature } = signed(stripe, event);

      const result = await processBookingWebhook(deps, rawBody, signature);

      expect(result).toEqual({ handled: false });
      expect(alert).not.toHaveBeenCalled();
      expect(await repo.listAllReservations()).toHaveLength(0);
      expect(await repo.listAllPayments()).toHaveLength(0);
    });
  });

  describe("Stripe sandbox — minting and retiring an intent (15.10, 15.11)", () => {
    /** A $1 intent, never confirmed — an intention to charge, not a charge. */
    const mint = (idempotencyKey: string) =>
      payments.createPaymentIntent({
        amountCents: 100,
        currency: "usd",
        description: "muster test:stripe — verification, never confirmed",
        metadata: {},
        idempotencyKey,
      });

    it("the idempotency key reaches Stripe: the same key returns the same intent, and Stripe recorded it", async () => {
      const since = sinceNow();
      const key = `sandbox_key_${randomUUID()}`;
      const created = await mint(key);

      // Stripe has no mechanism other than an idempotency key for associating two separate POSTs,
      // so one intent from two creates cannot happen without it. A dropped key yields two payable
      // intents where there should be one — which is exactly what 15.11's first cut shipped.
      const repeated = await mint(key);
      expect(repeated.paymentIntentId, "the key was DROPPED — two intents exist").toBe(
        created.paymentIntentId,
      );

      // And Stripe's own record of the key (`request.idempotency_key` on the event), so the claim is
      // Stripe reporting what it received rather than us reporting what we sent.
      const event = await eventFor(stripe, "payment_intent.created", created.paymentIntentId, since);
      expect(event.request?.idempotency_key).toBe(key);

      await payments.cancelPaymentIntent(created.paymentIntentId, "abandoned");
    });

    it("cancelling retires a live intent: it reads `unknown`, cannot be re-priced, and a second cancel is refused", async () => {
      const created = await mint(`sandbox_cancel_${randomUUID()}`);

      // Live, and payable — which for us means re-priceable (15.8's behaviour, whose residue 15.10
      // cleans up).
      expect(await payments.getPaymentIntentState(created.paymentIntentId)).toBe("reusable");
      expect(await threw(() => payments.updatePaymentIntentAmount(created.paymentIntentId, 200))).toBeNull();

      // 15.10's call. If Stripe rejects our argument shape or the reason string, it fails here.
      expect(await threw(() => payments.cancelPaymentIntent(created.paymentIntentId, "abandoned"))).toBeNull();

      // Stripe's `canceled` arrives as `unknown`, which tells a retry to mint fresh.
      expect(await payments.getPaymentIntentState(created.paymentIntentId)).toBe("unknown");

      // The outcome, not the call: nobody can pay it now.
      expect(
        await threw(() => payments.updatePaymentIntentAmount(created.paymentIntentId, 300)),
        "the amount could still be raised — the intent is still live",
      ).not.toBeNull();

      // The refusal both call sites swallow. On a webhook redelivery this happens every time; if it
      // did NOT throw, the best-effort catches would be dead code guarding nothing.
      expect(
        await threw(() => payments.cancelPaymentIntent(created.paymentIntentId, "duplicate")),
        "Stripe accepted a second cancel, so the swallow guards nothing",
      ).not.toBeNull();
    });
  });
}
