/**
 * The checkout action cannot fail silently (issue #773).
 *
 * **This is the last screen before money moves**, and it is where the project's own convention
 * was broken: `.claude/CLAUDE-context.md` § Conventions → Error Handling says *"Never `throw` in
 * server actions — return errors for inline feedback."* Every ANTICIPATED failure already
 * returned a message — flag off, unconfigured keys, missing name, bad phone, ungated waiver. The
 * unanticipated ones — a Stripe outage, a dropped connection, a cold database — rejected, and the
 * island's `onSubmit` had no `catch`: the Pay button re-enabled, nothing was said, and the
 * rational response to that is to tap it again.
 *
 * ## Why there are no module mocks here
 *
 * The first cut of this file mocked five modules — `next/headers`, the repo, the flags, the
 * Stripe port and `createDeparturePaymentIntent` — and `@code-review` caught it. `app/lib/
 * booking-deps.test.ts` states the convention and declines `vi.mock` for the directly analogous
 * case: *"the repository has no module mocking anywhere."* Shipping mocks here would have made
 * that sentence false in a file nobody was editing.
 *
 * It would also have been the weaker test. A slice of real code suspended between five fakes
 * proves as much about the fakes as about the code, and every one of those fakes is a claim about
 * a module's shape that nothing keeps true.
 *
 * So the file splits the way `booking-deps.test.ts` settled on:
 *
 *   - **`neverRejects` is tested directly** with a thunk that throws. Pure, no fakes, and it is
 *     the whole of the guarantee. It lives in `never-rejects.ts` rather than in the action file,
 *     because every export of a `"use server"` module is a public POST endpoint and this one
 *     takes a function as an argument (`/security-review`).
 *   - **The gates are tested through the real action**, which needs no fakes either — every one
 *     of them returns before a dependency is touched.
 *
 * What is left unproven by assertion is that the action APPLIES the wrapper, which is a one-line
 * read in a three-line function. Said out loud rather than papered over.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { startElementsCheckout } from "./actions.js";
// From its own module, not from the action file — `"use server"` turns every export into a
// public POST endpoint, and this helper invokes a caller-supplied function. See its header.
import { neverRejects } from "./never-rejects.js";

beforeEach(() => {
  // `RESERVATIONS` is off by default (DEC-111), and it is the FIRST gate — without this every
  // case below would pass through "Reservations are currently off." and assert nothing about the
  // gate it names. Real env, not a mocked flag module: `flagOn` reads `process.env` directly, so
  // there is nothing to fake.
  //
  // **`"1"`, not `"true"`.** `flagOn` is `process.env[name] === "1"` (`app/lib/flags.ts:16`), so
  // every other truthy-looking string is SILENTLY off. The first draft of this file used `"true"`
  // and three cases failed against "Reservations are currently off." — which is the trap
  // `env.example` documents as *"which flag values are silently wrong"*, met live. It is also
  // issue #761's shape, one flag over.
  process.env.RESERVATIONS = "1";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
});

describe("neverRejects — the guarantee", () => {
  it("turns a rejecting dependency into ok:false instead of throwing", async () => {
    // The defect, in one line. `createDeparturePaymentIntent` talks to Stripe and to Postgres;
    // either can fail in a way no guard above it anticipates.
    await expect(
      neverRejects(() => Promise.reject(new Error("stripe: 503 service unavailable"))),
    ).resolves.toMatchObject({ ok: false });
  });

  it("catches a SYNCHRONOUS throw too, not just a rejected promise", async () => {
    // `await run()` covers both, and the distinction is not academic: a bad argument or a missing
    // env read throws before any promise exists, and that is exactly the class nobody anticipates.
    await expect(
      neverRejects(() => {
        throw new TypeError("cannot read properties of undefined");
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("tells the customer NOTHING WAS CHARGED — the only fact they need", async () => {
    // Matching the configured-keys refusal a few lines up, which already says it. A customer
    // looking at a failed payment form has exactly one question, and leaving them to guess is
    // what makes them tap Pay again.
    const res = await neverRejects(() => Promise.reject(new Error("boom")));
    expect(res.ok === false && res.message).toMatch(/not been charged/i);
  });

  it("never puts the provider's error text on screen", async () => {
    // Same rule the trail emitters follow (`describeSendFailure`, issue #1052): a provider's
    // verbatim response body can carry a recipient address, an internal host, or a key prefix.
    // A public checkout form is a worse place to print one than a log line.
    const res = await neverRejects(() =>
      Promise.reject(new Error("pg: connection to server at 10.0.0.4:5432 failed — password auth")),
    );
    expect(res.ok === false && res.message).not.toMatch(/10\.0\.0\.4|password|pg:/);
  });

  it("passes a successful run straight through, untouched", async () => {
    // The guard that stops it becoming a blanket. A wrapper that rewrote successes would break
    // every booking while passing every case above.
    await expect(
      neverRejects(() => Promise.resolve({ ok: true as const, clientSecret: "cs_live_x" })),
    ).resolves.toEqual({ ok: true, clientSecret: "cs_live_x" });
  });
});

describe("startElementsCheckout — the gates still answer for themselves", () => {
  /** A submission that passes every gate; each case below breaks exactly one. None of these
   *  reaches a dependency, which is why this describe needs no fakes. */
  const VALID = {
    offeringId: "off-1",
    date: "2026-07-04",
    time: "13:30",
    guests: 4,
    gratuityBps: 2000,
    customerName: "Mary Brody",
    email: "m@x.io",
    phone: "+12165550148",
    waiverConsent: true,
  };

  it("keeps the SPECIFIC message for a bad phone", async () => {
    // The case that keeps the fix honest. A `try` wrapped around the whole function would pass
    // every `neverRejects` case above and flatten this into one generic line — and the
    // anticipated failures have actionable copy precisely because a customer can fix them.
    const res = await startElementsCheckout({ ...VALID, phone: "nonsense" });
    expect(res.ok === false && res.message).toMatch(/mobile number/i);
  });

  it("keeps the SPECIFIC message for a missing name", async () => {
    const res = await startElementsCheckout({ ...VALID, customerName: "   " });
    expect(res.ok === false && res.message).toMatch(/full name/i);
  });

  it("refuses an ungated waiver, before anything is charged", async () => {
    // DEC-110. Enforced here AND in the engine, so the checkbox cannot be spoofed past the charge.
    const res = await startElementsCheckout({ ...VALID, waiverConsent: false });
    expect(res.ok).toBe(false);
  });

  it("says so when the deployment has no Stripe keys, rather than throwing on undefined", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await startElementsCheckout(VALID);
    expect(res.ok === false && res.message).toMatch(/not been charged|isn['’]t configured/i);
  });
});
