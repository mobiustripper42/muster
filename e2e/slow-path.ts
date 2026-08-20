/**
 * Which server this run drives, and how much slack that earns (#763).
 *
 * The prebuilt server (`next start`) answers a test in 1–2s; `next dev` compiles routes on demand
 * and takes 4–9s for the same specs. One set of timeout constants cannot be right for both, and
 * the constants were written for the fast one — so the slow path, which is what CI runs, sat
 * permanently near every ceiling and tipped over under load, failing at whichever step the clock
 * happened to land on. Multiply, don't re-pick.
 *
 * **This file exists so there is exactly one spelling of the predicate.** The first cut defined
 * the multiplier inside `playwright.config.ts`, scaled the four budgets there, and silently missed
 * the fifth — the hydration poll in `fixtures.ts` that every `*Hydrated` helper routes through,
 * and therefore the one most exposed to the compile-on-demand latency the multiplier exists for.
 * The second cut duplicated the predicate here and got it WRONG in the only environment that
 * matters: CI leaves `E2E_PROD` unset, the config defaults it from `!CI`, and a copy that read
 * only the variable itself returned "fast path" on the slow one. Two spellings of one guard is
 * how `RESERVATIONS` came to be tested two ways (#588, #736) — same shape, caught earlier.
 */

/**
 * Prod server locally (it dodges the per-directory `next dev` lock), dev server in CI. Override
 * explicitly with `E2E_PROD=1` / `E2E_PROD=0` — only `"1"`/`"true"` enable it, so a stray
 * `E2E_PROD=false` reads as off rather than on.
 */
export const E2E_PROD =
  process.env.E2E_PROD != null
    ? process.env.E2E_PROD === "1" || process.env.E2E_PROD === "true"
    : !process.env.CI;

/** Multiply every timeout by this. 1 on the prebuilt server, 2 on the compile-on-demand one. */
export const SLOW_PATH = E2E_PROD ? 1 : 2;
