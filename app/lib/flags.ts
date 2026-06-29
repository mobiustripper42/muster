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
