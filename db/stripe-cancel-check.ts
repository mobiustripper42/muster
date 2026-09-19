/**
 * `db:stripe:cancel` — execute 15.10's cancel and 15.11's idempotency key against REAL Stripe,
 * through our own port.
 *
 *   npm run db:stripe:cancel
 *
 * **Why this exists.** 15.10 teaches the app to retire a PaymentIntent nobody may pay again, and
 * every green test proving it runs against `FakePaymentPort` — which is one developer's reading of
 * Stripe's documentation, not Stripe. The two paths that reach the new call in production (a state
 * read that threw, an amount update refused for a reason other than "already paid") cannot be
 * triggered from a browser, so the hand test for that PR could not reach the code it shipped. This
 * closes that: it runs the adapter the app runs, against the sandbox, and checks the OUTCOME.
 *
 * **Every step goes through `StripePaymentPort`.** No raw `stripe.paymentIntents.*` calls — the
 * point is to exercise the code the app executes, including the argument shapes, the `apiVersion`
 * pin and the status mapping. A script that called the SDK directly would prove Stripe works and
 * tell you nothing about `src/adapters/stripe-payment.ts`.
 *
 * **It moves no money.** A PaymentIntent that is never confirmed is an intention to charge, not a
 * charge; nothing is captured and nothing is refunded. It costs one API object in a sandbox.
 *
 * **Sandbox only, enforced.** Refuses any key that is not `sk_test_`. The whole script is a
 * sequence of create-and-destroy against an account, which is fine in a sandbox and is not
 * something to run against a live account by accident.
 *
 * This is issue #1021 in miniature — the Stripe round-trip check that should run at `/kill-this`
 * when a diff touches the money path. Written as a standalone script first because 15.10 is the PR
 * that needed it and did not have it.
 */
import { existsSync } from "node:fs";
import Stripe from "stripe";
import { StripePaymentPort } from "../src/adapters/stripe-payment.js";

// No `DATABASE_URL` dance here, unlike the other scripts in this directory: this one talks to
// Stripe and never opens the database, so there is no inline-vs-file precedence to get wrong.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const secretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

if (!secretKey) {
  console.error("STRIPE_SECRET_KEY is not set. Add it to .env.local and re-run.");
  process.exit(1);
}
// The key itself is NEVER printed — only its prefix, which is the part that decides safety.
if (!secretKey.startsWith("sk_test_")) {
  console.error(
    `Refusing to run: STRIPE_SECRET_KEY does not start with "sk_test_". This script creates and ` +
      `cancels PaymentIntents, which is a sandbox activity. Point .env.local at your sandbox key.`,
  );
  process.exit(1);
}

const payments = new StripePaymentPort(secretKey, webhookSecret);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (ok) {
    console.log(`  PASS  ${label}\n        ${detail}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}\n        ${detail}`);
  }
}

/** Run `fn` and report whether it threw. The best-effort catches in 15.10 exist because Stripe
 *  REFUSES these calls in ordinary situations, so "it threw" is the assertion, not an accident. */
async function threw(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function main(): Promise<void> {
  console.log(
    "\nThe idempotency key (15.11) and retiring an intent (15.10), against real Stripe,\n" +
      "through our own port\n",
  );

  // 1. Mint one, exactly as the checkout does.
  const key = `muster_check_${Date.now()}`;
  const createInput = {
    amountCents: 100,
    currency: "usd",
    description: "muster db:stripe:cancel — verification, never confirmed",
    metadata: {},
    idempotencyKey: key,
  };
  const created = await payments.createPaymentIntent(createInput);
  console.log(`  Minted ${created.paymentIntentId} for $1.00`);
  console.log(`  Idempotency key sent: ${key}\n`);

  // 2. **The idempotency key is actually SENT (15.11).** This check exists because the first cut
  //    of 15.11 computed the key, put it on the port type, threaded it to the adapter — and never
  //    passed it to Stripe. The whole suite stayed green, because every test runs against
  //    `FakePaymentPort`, which honoured it. Only a real round trip can tell the difference between
  //    a key that is sent and a key that is dropped, which is the entire argument for this script.
  const repeated = await payments.createPaymentIntent(createInput);
  check(
    "the same key returns the SAME intent — the key reaches Stripe",
    repeated.paymentIntentId === created.paymentIntentId,
    repeated.paymentIntentId === created.paymentIntentId
      ? `both creates returned ${created.paymentIntentId}`
      : `got ${repeated.paymentIntentId} and ${created.paymentIntentId} — the key was DROPPED, ` +
        `so two payable intents exist where there should be one`,
  );

  // 2b. **Stripe's own record of the key, so nobody has to take this script's word for it.**
  //
  // The check above is conclusive — Stripe has no mechanism other than an idempotency key for
  // associating two separate POSTs, so one intent from two creates cannot happen without it — but
  // "cannot happen otherwise" is an argument, and the operator asked to SEE the key. Stripe stores
  // it per request and exposes it on the event (`stripe/esm/resources/Events.d.ts:76`,
  // `request.idempotency_key`), which is Stripe reporting what it received rather than us
  // reporting what we sent.
  //
  // **This one query is the only raw SDK call in the script**, deliberately: our port has no
  // events method, and adding one to production code so a check could read it would be the tail
  // wagging the dog. Everything under test still goes through `StripePaymentPort`; this is
  // introspection of what that call left behind.
  const introspect = new Stripe(secretKey!);
  const events = await introspect.events.list({ limit: 20 });
  const ours = events.data.find(
    (e) =>
      e.type === "payment_intent.created" &&
      (e.data.object as Stripe.PaymentIntent).id === created.paymentIntentId,
  );
  const recorded = ours?.request?.idempotency_key ?? null;
  let recordedDetail: string;
  if (recorded === key) {
    recordedDetail = `event ${ours?.id} carries request.idempotency_key = ${recorded}`;
  } else if (recorded === null) {
    recordedDetail =
      `no payment_intent.created event found carrying an idempotency key — the create may have ` +
      `been keyless, or the event has not landed yet`;
  } else {
    recordedDetail = `Stripe recorded "${recorded}" but we sent "${key}"`;
  }
  check("Stripe recorded the key we sent, in its own words", recorded === key, recordedDetail);

  // 3. It must read as something a retry could be handed back.
  const before = await payments.getPaymentIntentState(created.paymentIntentId);
  check(
    "a fresh intent reads `reusable`",
    before === "reusable",
    `getPaymentIntentState → "${before}" (expected "reusable")`,
  );

  // 4. And it must actually be re-priceable, which is what "payable" means for our purposes —
  //    this is the 15.8 behaviour whose residue 15.10 cleans up.
  const raiseBefore = await threw(() =>
    payments.updatePaymentIntentAmount(created.paymentIntentId, 200),
  );
  check(
    "before the cancel, the amount can be raised — it is live",
    raiseBefore === null,
    raiseBefore === null ? "updatePaymentIntentAmount(200) succeeded" : `threw: ${raiseBefore}`,
  );

  // 5. **15.10's call.** If Stripe rejects our argument shape or the
  //    reason string, it fails here — and nothing in the test suite would ever have told us.
  const cancelError = await threw(() =>
    payments.cancelPaymentIntent(created.paymentIntentId, "abandoned"),
  );
  check(
    'cancelPaymentIntent(id, "abandoned") is accepted by Stripe',
    cancelError === null,
    cancelError === null ? "returned without throwing" : `threw: ${cancelError}`,
  );

  // 6. The status mapping, end to end: Stripe's `canceled` must arrive as `unknown`, which is what
  //    tells a retry to mint fresh rather than reuse a dead object.
  const after = await payments.getPaymentIntentState(created.paymentIntentId);
  check(
    "a cancelled intent reads `unknown`, so no retry will reuse it",
    after === "unknown",
    `getPaymentIntentState → "${after}" (expected "unknown")`,
  );

  // 7. **The outcome, not the call.** Everything above could pass while the intent stayed payable;
  //    this is the assertion that matches what the PR claims — nobody can pay it now.
  const raiseAfter = await threw(() =>
    payments.updatePaymentIntentAmount(created.paymentIntentId, 300),
  );
  check(
    "after the cancel, the amount can NO LONGER be raised — it is retired",
    raiseAfter !== null,
    raiseAfter !== null ? `threw, as it must: ${raiseAfter}` : "SUCCEEDED — the intent is still live",
  );

  // 8. The refusal both call sites swallow. On a webhook redelivery this happens every single
  //    time, and if it did NOT throw, the best-effort catches would be dead code hiding nothing.
  const secondCancel = await threw(() =>
    payments.cancelPaymentIntent(created.paymentIntentId, "duplicate"),
  );
  check(
    "cancelling an already-cancelled intent is REFUSED — the case both callers swallow",
    secondCancel !== null,
    secondCancel !== null
      ? `threw, as expected on a redelivery: ${secondCancel}`
      : "SUCCEEDED — Stripe accepted a second cancel, so the swallow guards nothing",
  );

  console.log(
    failures === 0
      ? "\nAll checks passed. The 15.10 path works against real Stripe, not just the fake.\n"
      : `\n${failures} check(s) FAILED. The fake and Stripe disagree — read the detail above.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error("\nThe script itself failed before it could finish:\n", e);
  process.exit(1);
});
