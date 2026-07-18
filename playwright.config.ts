import { defineConfig, devices } from "@playwright/test";

/**
 * e2e harness config (#65, Phase 5.5). First browser-test tooling in the project.
 *
 * Server mode — **`E2E_PROD` picks `next start` vs `next dev`** (defaults to `!CI`,
 * so local runs go prod, CI stays dev):
 *  - **Local → `next start` (prod build) + `VERCEL_ENV=preview`.** A second
 *    `next dev` in this directory can't start while the operator's `next dev` holds
 *    Next's per-directory dev lock (`⨯ Another next dev server is already running`),
 *    which is the common case on the dev box. `next start` takes no dev lock, so the
 *    suite runs alongside a live dev server. `/crew/dev-link` (every flow signs in
 *    through it) 404s only when `isProdDeploy` — i.e. `VERCEL_ENV==="production"` or
 *    (no `VERCEL_ENV` && `NODE_ENV==="production"`). `next start` sets the latter, so
 *    `VERCEL_ENV=preview` is load-bearing: it flips `isProdDeploy` false and keeps the
 *    minter live exactly as on a real Vercel preview. Bonus: prod rendering catches the
 *    RSC serialization bugs `next dev` masks. Cost: a cold run pays a `next build`;
 *    `reuseExistingServer` amortizes it across warm runs.
 *  - **CI → `next dev`.** No dev lock and no `.env.local` in CI, so the collision never
 *    bites; skipping the build keeps the e2e job fast.
 *  - **A dedicated port (3100) + the throwaway `muster_test` DB.** The app under
 *    test must never reuse a running `npm run dev` (that one points at muster_dev);
 *    the dedicated port keeps the two from colliding and the test DB from leaking
 *    into dev data.
 *
 * Single worker: the specs reset+seed one shared test DB in beforeEach, which is
 * only deterministic if they don't overlap.
 */

// Prod server locally (dodges the per-dir `next dev` lock), dev server in CI.
// Override explicitly with E2E_PROD=1 / E2E_PROD=0 (only "1"/"true" enable it, so
// a stray `E2E_PROD=false` reads as off, not on).
const E2E_PROD =
  process.env.E2E_PROD != null
    ? process.env.E2E_PROD === "1" || process.env.E2E_PROD === "true"
    : !process.env.CI;

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://muster:muster@localhost:5432/muster_test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // 375px render pass — wires failure screenshots into @ui-reviewer (#65).
      // Scoped to the surfaces with real mobile layout risk; the functional flows
      // don't vary by viewport, so the rest stays desktop-only to save wall-clock.
      // Covers: crew (auth-crew), the admin nav + hamburger drawer (admin-nav), the
      // outbox copy/overflow + Dismiss|Send (outbox-relay), the messaging surfaces
      // (#117 — chat bubbles, the 3-button co-crew row, the compose box), the
      // fixed corner version tag (version-tag — must clear content at 375px), the
      // crew self-serve sign-in form + code entry (crew-sign-in — DEC-081), and the
      // all-shifts filter bar (shifts-view — 5 preset chips + date + crew dropdown
      // that must wrap, not overflow, at 375px — #321/#330).
      name: "mobile",
      testMatch: /(auth-crew|admin-nav|outbox-relay|crew-messaging|operator-messaging|version-tag|crew-sign-in|crew-open|crew-reconciliation|crew-help|cockpit-manifest|cockpit-override|ask-trail|time-off|payroll|shifts-view|calendar-feed|other-shifts-today)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    // Prod: build once, then `next start` (no dev lock). reuseExistingServer skips
    // the rebuild when a server is already warm on the port.
    command: E2E_PROD
      ? `npm run build && npx next start --port ${PORT}`
      : `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    // Prod path includes a `next build`; give it room. Dev path compiles lazily.
    timeout: E2E_PROD ? 300_000 : 120_000,
    // Safe to reuse locally because the port is e2e-dedicated (only ever an
    // e2e/test-DB server). Never reuse in CI. NB on the prod path a reused server
    // serves its *frozen* `.next-e2e` build — a `next start` left listening on the
    // port from a prior run means later runs skip the rebuild and test stale code.
    // The normal flow tears the server down between runs (so each rebuilds); only a
    // manually-left server goes stale — kill :3100 if you changed app code.
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      // Prod server only: keep `/crew/dev-link` live (isProdDeploy → false) exactly
      // as on a Vercel preview, and pin E2E_PROD so the build/start subprocess picks
      // the `.next-e2e` distDir (next.config.ts) instead of the operator's `.next`.
      ...(E2E_PROD ? { VERCEL_ENV: "preview", E2E_PROD: "1" } : {}),
      // Civil send window (DEC-088) wide open: e2e runs at arbitrary wall-clock
      // times, and the bail/ask flows it drives must not defer past 20:00.
      CIVIL_SEND_START: "00:00",
      CIVIL_SEND_END: "23:59", // NB half-open: 23:59:00–:59 is OUTSIDE — HH:MM bounds can't close the last minute; avoid 23:59 test clocks
      // Dev-default secret is fine for tests; pin it so cookies stay valid across
      // a server restart within a run.
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-test-secret",
      // The doorbell cron is CRON_SECRET-gated; pin one so the ring-relay e2e can
      // trigger a tick (the only way to exercise the relay end-to-end).
      CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret",
      // Crew self-serve code login (DEC-081) is flag-gated OFF in prod until 7.0b
      // wires real email; the e2e env is where we exercise it, so turn it on.
      CREW_SELF_SERVE: "1",
      // Messaging (#389) is disabled in prod (kill switch, off by default), but the
      // code stays and its e2e specs must keep exercising it — turn it on here.
      MESSAGING: "1",
      // Blank Twilio so notice/SMS e2e uses the OUTBOX channel, not live Twilio.
      // `.env.local` (auto-loaded by next dev/start) holds real Twilio creds for
      // the live-SMS smoke (#242/#252); without this override the notice path
      // would send to the fake seed phones and 400 ("not a valid phone number"),
      // which the best-effort catches swallow → an empty outbox → a false failure
      // (e.g. trainee-staffing's "you're on" assertion). Empty overrides .env.local.
      TWILIO_ACCOUNT_SID: "",
      TWILIO_AUTH_TOKEN: "",
      TWILIO_FROM: "",
      TWILIO_MESSAGING_SERVICE_SID: "",
    },
  },
});
