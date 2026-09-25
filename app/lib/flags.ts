/**
 * Feature flags (env-driven). One place so the gate reads the same everywhere.
 *
 * **Every flag is on for `1` and nothing else** (#736). `RESERVATIONS` used to test `=== "true"`
 * while its three siblings tested `=== "1"`, so `RESERVATIONS=1` read false and turned the booking
 * flow off with no error and no warning. Read the value through `flagOn` — a flag hand-spelled
 * against `process.env` is how the asymmetry got in.
 *
 * `CREW_SELF_SERVE` lived here until DEC-175. It gated the crew code login while email delivery
 * was unwired, was turned on in production once it was, and then guarded a state that no longer
 * existed anywhere — on in prod, on in e2e, so its off-branch never executed. What a flag like
 * that buys is an untested path: nobody knew what `/crew` rendered with it off, because nothing
 * ran that way. Deleted rather than left as reassurance.
 *
 * `RESERVATIONS` went the same way at issue #1093. It kept the customer booking flow dark, but
 * reservations are not an optional half of the product, and the real gate on taking money is
 * whether Stripe keys are configured — without them checkout refuses before any row or charge.
 */
function flagOn(name: string): boolean {
  return process.env[name] === "1";
}

/**
 * `MESSAGING` (#389): the in-app messaging feature (crew↔crew DMs, the operator
 * "from the office" broadcast, threads, and the doorbell that rings about them).
 * **OFF by default** — a deliberate kill switch (operator's call 2026-07-12): the
 * entry points don't render, the `/crew/threads` + `/admin/messages` routes 404,
 * and the doorbell sweep no-ops (so it can't ring about pre-existing unread
 * threads once the buttons are gone). The code is all left in place — flip
 * `MESSAGING=1` to restore the whole feature. e2e sets it on to keep exercising it.
 */
export function messagingEnabled(): boolean {
  return flagOn("MESSAGING");
}

/**
 * `TIME_CLOCK` (#628, SPEC §2.9): the whole Phase 13 punch clock — `/crew/time`, the crew hub's
 * Time tile, `/admin/time-clock`, the Actual-hours reconcile on `/admin/payroll`, and the Gusto
 * export route. **OFF by default**, same kill-switch shape as `MESSAGING` above.
 *
 * The point is that `main` stays promotable while the phase is still landing: the schema goes to
 * production ahead of the code (migrations are applied out-of-band), and a half-finished timesheet
 * is worse than none — crew would clock in against a surface the operator can't yet repair.
 *
 * **Gate the ROUTE, not just the nav.** #621 is the standing example of getting this wrong: the
 * since-deleted RESERVATIONS switch hid its links and left the admin routes reachable by URL,
 * which is a kill switch that doesn't kill anything. Every entry point below 404s, not just un-links.
 */
export function timeClockEnabled(): boolean {
  return flagOn("TIME_CLOCK");
}

/**
 * True on any PRODUCTION deploy — Vercel prod (`VERCEL_ENV`) or a self-hosted
 * prod (`next start` with no `VERCEL_ENV`, `NODE_ENV=production`). The single
 * predicate the dev-only affordances gate on (the
 * dev-code echo route, and the login-code log/echo), so "live on preview + local,
 * 404/inert in prod" stays consistent across all three (DEC-057).
 */
// Re-exported from core (`src/config/deploy.ts`) rather than spelled here, so the predicate has
// exactly ONE definition. It moved down when `src/reservations/claim.ts` needed the same guard and
// core cannot import from `app/` — see that file for the reasoning. Every caller of
// `isProdDeploy` from `app/lib/flags` keeps working unchanged.
export { isProdDeploy } from "@core/config/deploy.js";
