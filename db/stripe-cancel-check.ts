/**
 * `db:stripe:cancel` — execute 15.10's cancel against REAL Stripe, through our own port.
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
  console.log("\n15.10 — retiring a PaymentIntent, against real Stripe, through our own port\n");

  // 1. Mint one, exactly as the checkout does.
  const created = await payments.createPaymentIntent({
    amountCents: 100,
    currency: "usd",
    description: "muster db:stripe:cancel — 15.10 verification, never confirmed",
    metadata: {},
  });
  console.log(`  Minted ${created.paymentIntentId} for $1.00\n`);

  // 2. It must read as something a retry could be handed back.
  const before = await payments.getPaymentIntentState(created.paymentIntentId);
  check(
    "a fresh intent reads `reusable`",
    before === "reusable",
    `getPaymentIntentState → "${before}" (expected "reusable")`,
  );

  // 3. And it must actually be re-priceable, which is what "payable" means for our purposes —
  //    this is the 15.8 behaviour whose residue 15.10 cleans up.
  const raiseBefore = await threw(() =>
    payments.updatePaymentIntentAmount(created.paymentIntentId, 200),
  );
  check(
    "before the cancel, the amount can be raised — it is live",
    raiseBefore === null,
    raiseBefore === null ? "updatePaymentIntentAmount(200) succeeded" : `threw: ${raiseBefore}`,
  );

  // 4. **The call this whole script exists for.** If Stripe rejects our argument shape or the
  //    reason string, it fails here — and nothing in the test suite would ever have told us.
  const cancelError = await threw(() =>
    payments.cancelPaymentIntent(created.paymentIntentId, "abandoned"),
  );
  check(
    'cancelPaymentIntent(id, "abandoned") is accepted by Stripe',
    cancelError === null,
    cancelError === null ? "returned without throwing" : `threw: ${cancelError}`,
  );

  // 5. The status mapping, end to end: Stripe's `canceled` must arrive as `unknown`, which is what
  //    tells a retry to mint fresh rather than reuse a dead object.
  const after = await payments.getPaymentIntentState(created.paymentIntentId);
  check(
    "a cancelled intent reads `unknown`, so no retry will reuse it",
    after === "unknown",
    `getPaymentIntentState → "${after}" (expected "unknown")`,
  );

  // 6. **The outcome, not the call.** Everything above could pass while the intent stayed payable;
  //    this is the assertion that matches what the PR claims — nobody can pay it now.
  const raiseAfter = await threw(() =>
    payments.updatePaymentIntentAmount(created.paymentIntentId, 300),
  );
  check(
    "after the cancel, the amount can NO LONGER be raised — it is retired",
    raiseAfter !== null,
    raiseAfter !== null ? `threw, as it must: ${raiseAfter}` : "SUCCEEDED — the intent is still live",
  );

  // 7. The refusal both call sites swallow. On a webhook redelivery this happens every single
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
