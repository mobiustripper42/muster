/**
 * Feature flags (env-driven). One place so the gate reads the same everywhere.
 *
 * `CREW_SELF_SERVE` (DEC-081, DEC-059): the crew code-login front door. OFF by
 * default so `main` stays promotable to production at all times — until 7.0b
 * wires real email delivery (Resend on a DKIM-verified `crew.brewcle.com`), a
 * login that says "check your email" and emails nothing would be a broken prod
 * login. Flip it on (set the env var) once delivery is real. e2e turns it on to
 * exercise the flow against the fake channel.
 */
export function selfServeEnabled(): boolean {
  return process.env.CREW_SELF_SERVE === "1";
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
  return process.env.MESSAGING === "1";
}

/**
 * `RESERVATIONS` (DEC-111): the customer-facing booking flow — `/book`, checkout, the manage
 * link, and the Stripe webhook that turns a charge into a reservation. **OFF by default**;
 * DEC-111's whole point is that money must not reach production until one real paid
 * reservation has validated end to end.
 *
 * Note the value is `"true"`, not the `"1"` its two siblings above use. That asymmetry predates
 * this function and is left alone deliberately: it is already set in deployed environments, and
 * changing the accepted value would silently turn the feature off on a deploy nobody re-read.
 *
 * This function exists because the predicate was hand-spelled at five call sites (#588). That is
 * the same shape as the auth-sweep defect where `dev-link` carried its own copy of the
 * production kill-switch while two other files imported the shared one — two spellings of one
 * guard, and only one of them ever gets fixed.
 */
export function reservationsEnabled(): boolean {
  return process.env.RESERVATIONS === "true";
}

/**
 * True on any PRODUCTION deploy — Vercel prod (`VERCEL_ENV`) or a self-hosted
 * prod (`next start` with no `VERCEL_ENV`, `NODE_ENV=production`). The single
 * predicate the dev-only affordances gate on (dev-link's inline copy, the
 * dev-code echo route, and the login-code log/echo), so "live on preview + local,
 * 404/inert in prod" stays consistent across all three (DEC-057).
 */
export function isProdDeploy(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    (!process.env.VERCEL_ENV && process.env.NODE_ENV === "production")
  );
}
