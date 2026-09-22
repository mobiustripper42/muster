import { logSwallowed } from "../../../lib/swallowed";
// Type-only, so it is erased at compile time — this module never imports the
// `"use server"` one at runtime, which is the whole point of the split.
import type { StartElementsCheckoutResult } from "./actions";

/**
 * Run the checkout's dependency work, turning ANY rejection into a customer-safe refusal
 * (issue #773).
 *
 * ## Why this is its own file rather than a helper in `actions.ts`
 *
 * **`actions.ts` is `"use server"`, and every export of such a module is a registered Server
 * Action** — a POST endpoint anyone on the internet can reach. `/security-review` traced what
 * that meant for a function like this one, which takes a caller-supplied function and calls it:
 * React's reply decoder does accept a server reference in an arbitrary argument position, so
 * `$h<ref>` in argument 0 decodes to something callable.
 *
 * It found the attack closed — Next scopes action ids to the worker set of the page being POSTed
 * to, so only this page's two actions resolve and both are already public. **But the thing
 * closing it is a bundler implementation detail**, and Next's own source carries a
 * `TODO: This is currently not guaranteed in Turbopack` against that partitioning.
 *
 * So this lives outside the `"use server"` boundary. It stops being an endpoint, the exploit
 * primitive stops existing, and nothing rests on a framework internal staying true. It was also
 * the only non-action export in any of the repository's 27 `"use server"` files — a first of its
 * kind is worth a second look by definition.
 *
 * ## Why it takes the work as a thunk
 *
 * So the guarantee is provable with no module mocking. `app/lib/booking-deps.test.ts` states this
 * repository's convention and declines `vi.mock` for the directly analogous case; the first cut
 * of this change mocked five modules and `@code-review` caught it. A slice of real code suspended
 * between five fakes proves as much about the fakes as about the code.
 */
export async function neverRejects(
  run: () => Promise<StartElementsCheckoutResult>,
): Promise<StartElementsCheckoutResult> {
  try {
    return await run();
  } catch (e) {
    // The provider's text never reaches the customer. A `pg:` message carries a host and a
    // failure mode; a Stripe one can carry a key prefix. Same rule `describeSendFailure` enforces
    // for channel errors (issue #1052) — the log gets the error, the screen gets a sentence.
    logSwallowed("book/checkout:startElementsCheckout", e, "the checkout could not be started");
    return {
      ok: false,
      // The one fact a customer looking at a failed payment form needs, in the voice the rest of
      // this flow already uses (`checkout-form.tsx`'s confirm fallback says the same thing).
      message: "Something went wrong on our side — you have not been charged. Please try again.",
    };
  }
}
