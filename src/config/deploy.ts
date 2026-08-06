/**
 * Which kind of deploy is this? — the one spelling of the production predicate.
 *
 * **Why it lives in core rather than `app/lib/flags.ts`, where it started.** Core cannot import
 * from `app/`, so when `src/reservations/claim.ts` needed the same guard (the `CHECKOUT_HOLD_MINUTES`
 * dev override) the obvious move was to hand-copy it. `@code-review` caught that, and it was right:
 * `flags.ts`'s own comment documents this exact defect class — the predicate "was hand-spelled at
 * five call sites (#588) … two spellings of one guard, and only one of them ever gets fixed."
 * Duplicating it again, on the guard standing between an env var and a real buyer's checkout hold,
 * would have been the same mistake with a fresh justification.
 *
 * Direction matters: `app/` already imports env-driven config FROM core (`tenant.ts` supplies
 * `TENANT_TIMEZONE`, the DEC-060 windows, and more), so moving it down and re-exporting it up is
 * the direction the codebase already runs. `app/lib/flags.ts` re-exports this, so its callers are
 * untouched.
 */

/**
 * True on any PRODUCTION deploy — Vercel prod (`VERCEL_ENV`) or a self-hosted prod (`next start`
 * with no `VERCEL_ENV` and `NODE_ENV=production`).
 *
 * **`VERCEL_ENV` is primary, and that ordering is load-bearing:** Vercel sets
 * `NODE_ENV=production` on PREVIEW deploys too, so a `NODE_ENV`-only check would read `true` on a
 * preview and disable every dev affordance exactly where a reviewer needs them — the DEC-057
 * reasoning that keeps `dev-link` alive on previews. The `NODE_ENV` fallback re-closes the gate on
 * a self-hosted prod where `VERCEL_ENV` is absent.
 *
 * Read at CALL time, not module load: `dev-link` and friends gate per request, and a predicate
 * frozen at import would be wrong in any process whose env is set up after the module graph loads.
 */
export function isProdDeploy(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    (!process.env.VERCEL_ENV && process.env.NODE_ENV === "production")
  );
}
