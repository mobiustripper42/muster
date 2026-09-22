/**
 * The booking wiring (issue #827, 15.17) — that the money alert is wrapped before it reaches the
 * core.
 *
 * **Why this asserts identity rather than behaviour, and why that is a choice rather than a
 * limit.** The obvious test is "make the alert throw, check the wired dep resolves". Written
 * against the real `alertMoneyProblem` it would assert nothing — that function already cannot
 * reject (`alert.ts:110-124`), so wrapped and unwrapped are indistinguishable and the case would
 * pass with the wrapper deleted. It *could* be written with `vi.mock("./alert")`, and the first
 * draft of this docstring called it impossible, which was wrong (`@code-review`). It is declined
 * for two reasons: the repository has no module mocking anywhere — the single mention of
 * `vi.mock` is a comment in `stripe-payment.test.ts` explaining why that file does without it —
 * and the behaviour is already proven directly in `booking-webhook.test.ts`.
 *
 * The chain is two links, each proven where it is cheapest: those cases prove what
 * `alertThatNeverThrows` DOES to a rejecting alert, and this one proves it is APPLIED. Deleting
 * the wrapper's body reds the first; deleting its application here reds the second.
 *
 * **Nothing in this file calls the wired dependency.** The first draft did — `await
 * deps.alertPaidButUnbooked("probe")` — and `@code-review` caught that it runs the real
 * `alertMoneyProblem`, which opens a real Postgres connection through `getRepo()` and would reach
 * real Twilio on any machine where those credentials happen to be exported. A test that texts an
 * admin the word "probe" is not a unit test. Every other `WebhookDeps` test in the repo injects a
 * fake for exactly this reason.
 */
import { describe, expect, it } from "vitest";
import { alertMoneyProblem } from "./alert";
import { bookingDeps } from "./booking-deps";

describe("bookingDeps — the money alert cannot 500 the webhook", () => {
  it("wraps alertPaidButUnbooked rather than passing the raw sender through", () => {
    // Constructing deps is inert: `bookingDeps` only builds the object. The key is a syntactically
    // valid test key that is never used, because nothing here calls Stripe either.
    const deps = bookingDeps("sk_test_not_a_real_key");
    // Unwrapped, this WOULD be `alertMoneyProblem`. A wrapper is a different function object, so
    // removing it at the wiring fails here — which is this file's entire job.
    expect(deps.alertPaidButUnbooked).not.toBe(alertMoneyProblem);
  });
});
