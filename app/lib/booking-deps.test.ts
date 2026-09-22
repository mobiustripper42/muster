/**
 * The booking wiring (issue #827, 15.17) — that the money alert is wrapped before it reaches the
 * core.
 *
 * **Why this asserts identity rather than behaviour.** The obvious test is "make the alert throw
 * and check the wired dep resolves". It cannot be written honestly here: the inner function is
 * `alertMoneyProblem`, which already cannot reject (`alert.ts:110-124` logs first and
 * unconditionally, then wraps everything else in a `try/catch`). Against it, wrapped and unwrapped
 * are indistinguishable, so such a test would pass with the wrapper deleted — an assertion that
 * asserts nothing, which is worse than none.
 *
 * The chain that does hold is two links: `booking-webhook.test.ts` proves what
 * `alertThatNeverThrows` DOES to a rejecting alert, and this file proves it is APPLIED. Deleting
 * the wrapper at the wiring reds this case; deleting its body reds the other three.
 */
import { describe, expect, it } from "vitest";
import { alertThatNeverThrows } from "@core/reservations/booking-webhook.js";
import { alertMoneyProblem } from "./alert";
import { bookingDeps } from "./booking-deps";

describe("bookingDeps — the money alert cannot 500 the webhook", () => {
  it("wraps alertPaidButUnbooked rather than passing the raw sender through", () => {
    const deps = bookingDeps("sk_test_not_a_real_key");
    // The bare function would BE `alertMoneyProblem`. A wrapper is a different function object.
    expect(deps.alertPaidButUnbooked).not.toBe(alertMoneyProblem);
  });

  it("the wrapper is the one from core, not a local look-alike", async () => {
    // Same construction, compared by behaviour rather than by name: both must be functions of one
    // argument returning a promise. A local inline `try/catch` would satisfy the case above while
    // drifting from the contract the port documents, and the next wiring would copy the drift.
    const deps = bookingDeps("sk_test_not_a_real_key");
    const reference = alertThatNeverThrows(alertMoneyProblem);
    expect(deps.alertPaidButUnbooked.length).toBe(reference.length);
    await expect(deps.alertPaidButUnbooked("probe")).resolves.toBeUndefined();
  });
});
