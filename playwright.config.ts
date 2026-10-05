import { defineConfig, devices } from "@playwright/test";

/**
 * e2e harness config (#65, Phase 5.5). First browser-test tooling in the project.
 *
 * **Two servers, chosen per project (#1169)** — the same locally and in CI:
 *  - **Prebuilt (`next build` + `next start`) on `E2E_PORT` (3100)** drives setup, desktop and
 *    mobile — nearly the whole suite. It answers a test in 1–2s against `next dev`'s 4–9s, and
 *    it has no memory-threshold restart: a single `next dev` serving all ~600 tests in CI
 *    restarted itself ~40 minutes in and failed whichever test was running. `VERCEL_ENV=preview`
 *    is load-bearing: `next start` sets NODE_ENV=production, which alone would make
 *    `isProdDeploy` true and 404 the sign-in code echo every flow signs in through; preview
 *    flips it false, exactly as on a real Vercel preview. Bonus: prod rendering catches the RSC
 *    serialization bugs `next dev` masks. Cost: each run pays a `next build`.
 *  - **`next dev` on `E2E_PORT + 1`** drives the iPhone project only — see its entry for why it
 *    cannot use the prebuilt server. It builds into `.next-e2e-dev` (next.config.ts), and Next's
 *    dev lock is per build dir, so it starts beside the operator's own `npm run dev`. It serves
 *    one spec, so it stays small. Skipped when `--project` names only other projects
 *    (`needsDevServer`), since Playwright boots every server whatever the filter.
 *  - **Dedicated ports + the throwaway `muster_test` DB.** The app under test must never reuse a
 *    running `npm run dev` (that one points at muster_dev); the dedicated ports keep the two
 *    from colliding and the test DB from leaking into dev data.
 *
 * Single worker: the specs reset+seed one shared test DB in beforeEach, which is only
 * deterministic if they don't overlap. Both servers share that DB, which is safe for the same
 * reason.
 */

// The server → slack table is defined ONCE, in `e2e/slow-path.ts`, because `fixtures.ts` needs the
// same multiplier for its hydration poll and a second copy got the CI case backwards (#763).
import { needsDevServer, SLOW_PATH_FOR, type E2EServer } from "./e2e/slow-path.js";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const DEV_PORT = PORT + 1;
const DEV_URL = `http://localhost:${DEV_PORT}`;
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://muster:muster@localhost:5432/muster_test";

/**
 * **The budget follows the server, not the test** (#763). The dev path compiles routes on demand
 * and runs 3–4× slower per test than the prebuilt one — measured on the same specs at 4–9s versus
 * 1–2s. A 30s ceiling is generous on `next start` and marginal on `next dev`, so a multi-page test
 * drifts over it under load and then fails at whichever step the clock happened to land on:
 * `apiRequestContext.get: Test ended` in one run, a `waitForURL` timeout in the next. One slow
 * test, two unrelated-looking errors.
 *
 * Raising it hides no hang: a genuinely stuck test still fails, one multiple later.
 *
 * **All four budgets scale together, deliberately.** Raising only the per-test ceiling moved the
 * failure rather than removing it: the next runs died on `expect`'s 10s and on the 15s action
 * timeout instead, one per run, each in a different spec — which looks like three separate flaky
 * tests and is one mis-set constant seen three ways. They are one knob because they measure the
 * same thing: how long this server takes to answer.
 *
 * Spread into each project, with the project's own `use` merged over `use` here.
 */
function onServer(server: E2EServer) {
  const k = SLOW_PATH_FOR[server];
  return {
    metadata: { server },
    timeout: 30_000 * k,
    expect: { timeout: 10_000 * k },
    use: {
      baseURL: server === "dev" ? DEV_URL : BASE_URL,
      navigationTimeout: 30_000 * k,
      actionTimeout: 15_000 * k,
    },
  };
}
const PREBUILT = onServer("prebuilt");
const DEV = onServer("dev");

/** Both servers get these. Each adds what is particular to it. */
const SERVER_ENV = {
  DATABASE_URL: TEST_DATABASE_URL,
  // Suppresses the Next dev-tools badge (next.config.ts). It is a fixed bottom-left overlay
  // that expands over page content, and on the dev-server path it swallowed clicks on
  // controls that happened to sit under it. Framework chrome shouldn't be in the viewport
  // during a test run.
  E2E: "1",
  // Civil send window (DEC-088) wide open: e2e runs at arbitrary wall-clock
  // times, and the bail/ask flows it drives must not defer past 20:00.
  CIVIL_SEND_START: "00:00",
  CIVIL_SEND_END: "23:59", // NB half-open: 23:59:00–:59 is OUTSIDE — HH:MM bounds can't close the last minute; avoid 23:59 test clocks
  // Dev-default secret is fine for tests; pin it so cookies stay valid across a server
  // restart within a run — and across the two servers, which is what lets the iPhone
  // project load sessions the setup project signed in for on the prebuilt one.
  SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-test-secret",
  // The doorbell cron is CRON_SECRET-gated; pin one so the ring-relay e2e can
  // trigger a tick (the only way to exercise the relay end-to-end).
  CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret",
  // Messaging (#389) is disabled in prod (kill switch, off by default), but the
  // code stays and its e2e specs must keep exercising it — turn it on here.
  MESSAGING: "1",
  // The Phase 13 time clock (#628) is a kill switch, OFF in prod until the phase ships.
  // The e2e is where it gets exercised, so turn it on — same posture as MESSAGING above.
  // NB the flag-OFF behaviour (routes 404, actions refuse) can't be covered here: this env
  // is per-RUN, not per-test, so a spec can't turn it off for itself. That gap is why
  // `app/lib/time-clock-gate.test.ts` asserts the wiring structurally instead.
  TIME_CLOCK: "1",
  // No RESERVATION_LINK_SECRET any more (#741, DEC-154): the manage link is a stored code
  // (`/b/<code>`), so there is no secret for the suite to pin and no HMAC for a spec to
  // mirror. The seed writes the codes; `reservation-demo.ts` re-derives them.
  // The checkout screen (12.5, DEC-134) hard-gates on the BUILD-INLINED publishable key
  // (missing ⇒ a loud config-error state instead of the form). A dummy test key lets the
  // form render; the e2e never crosses stripe.confirmPayment (no Stripe network), so the
  // value is never used against Stripe.
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "pk_test_e2e_dummy",
  // Blank Twilio so notice/SMS e2e uses the log channel (#934), not live Twilio.
  // `.env.local` (auto-loaded by next dev/start) holds real Twilio creds for
  // the live-SMS smoke (#242/#252); without this override every relay would send
  // real texts to the fake seed phones and 400 ("not a valid phone number"). Empty
  // overrides .env.local.
  TWILIO_ACCOUNT_SID: "",
  TWILIO_AUTH_TOKEN: "",
  TWILIO_FROM: "",
  TWILIO_MESSAGING_SERVICE_SID: "",
  // Blank Resend for the same reason. `.env.local` holds a real key, and `sendLoginCodeEmail`
  // sends whenever both vars are set, in any environment — so every code sign-in in the suite
  // was a real Resend send to an undeliverable `@bb.test` address, counted against the daily
  // quota and bounced. Nothing here needs the email: the suite reads codes from the dev-only
  // `/crew/dev-code` echo. The count jumped when every sign-in moved to the code door, which
  // is how it nearly exhausted the quota.
  RESEND_API_KEY: "",
  EMAIL_FROM: "",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // Signs in ONCE per saved identity through the code door (`e2e/auth.setup.ts`). Every
      // project below depends on it, so a filtered run (`--project=mobile`) still gets it.
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      ...PREBUILT,
      use: { ...devices["Desktop Chrome"], ...PREBUILT.use },
    },
    {
      name: "desktop",
      dependencies: ["setup"],
      ...PREBUILT,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, ...PREBUILT.use },
    },
    {
      // 375px render pass — wires failure screenshots into @ui-reviewer (#65).
      // Scoped to the surfaces with real mobile layout risk; the functional flows
      // don't vary by viewport, so the rest stays desktop-only to save wall-clock.
      // Covers: crew (auth-crew), the admin nav + hamburger drawer (admin-nav), the
      // messaging surfaces
      // (#117 — chat bubbles, the 3-button co-crew row, the compose box), the
      // fixed corner version tag (version-tag — must clear content at 375px), the
      // crew self-serve sign-in form + code entry (crew-sign-in — DEC-081), and the
      // all-shifts filter bar (shifts-view — 5 preset chips + date + crew dropdown
      // that must wrap, not overflow, at 375px — #321/#330), and the time clock both
      // sides (#626/#627 — the crew card is phone-primary, and the admin punch card
      // packs two <input type="time"> plus Save on one row, the tightest row in §2.9).
      name: "mobile",
      dependencies: ["setup"],
      testMatch: /(auth-crew|admin-nav|crew-messaging|operator-messaging|version-tag|crew-sign-in|crew-open|crew-reconciliation|crew-help|cockpit-manifest|cockpit-override|time-off|payroll|payroll-reconcile|shifts-view|calendar-feed|other-shifts-today|vessel-location-admin|offering-catalog|add-ons|blocks|calendar|calendar-list|customers|purchases|book-availability|book-checkout|book-manage|booking-cutoff|phone-booking|pay-link|crew-time|admin-time-clock|waiver-admin|trip-link|signing|check-in|party-page)\.spec\.ts/,
      ...PREBUILT,
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, ...PREBUILT.use },
    },
    {
      // The only WebKit pass in the suite (#655). Everything above — including the project
      // literally called "mobile" — is Chromium; `devices["Desktop Chrome"]` at 375px is a
      // narrow window, not a phone and not Safari. That is why an iPhone-only nav bug reached
      // the operator: no test in this repo could execute Safari's focus semantics.
      //
      // Deliberately ONE spec. Turning WebKit on suite-wide lights up unrelated failures and
      // needs its own triage; this pins the one behaviour that has actually bitten. Widen it
      // when there is appetite to work through what it surfaces, not before.
      //
      // Playwright's Linux WebKit is not iOS Safari — same engine, different platform — so a
      // pass here is evidence, not proof. It does carry `isMobile` + `hasTouch`, which is what
      // makes `tap()` behave like a tap rather than a click.
      //
      // **Why this project runs on `next dev`, not the prebuilt server (#1169).** `next start`
      // sets NODE_ENV=production, which makes the session cookie `Secure` (app/lib/auth.ts:54) —
      // correct in production, fatal here, because the e2e server is plain http and WebKit refuses
      // Secure cookies over it. Chromium special-cases localhost and stores them anyway, which is
      // why only this project notices. Symptom is not an auth error: sign-in redirects, the URL
      // looks right, and every page renders signed-out with no cookies at all. A test-only switch
      // to turn Secure off was rejected: it would sit in the Auth code, one misconfigured env var
      // away from weakening production cookies. A second server changes test config only.
      //
      // The saved sessions it loads were minted by the setup project on the prebuilt server, so
      // they arrive marked Secure; `fixtures.ts` loads them unmarked for this project — the same
      // cookie `next dev` would have set (see `loadSavedSession`).
      name: "iphone",
      dependencies: ["setup"],
      testMatch: /admin-nav\.spec\.ts/,
      ...DEV,
      use: { ...devices["iPhone 13"], ...DEV.use },
    },
  ],
  webServer: [
    {
      // Build once, then `next start` (no dev lock).
      command: `npm run build && npx next start --port ${PORT}`,
      url: BASE_URL,
      // Includes a `next build`; give it room.
      timeout: 300_000,
      // Safe to reuse locally because the port is e2e-dedicated (only ever an e2e/test-DB
      // server). Never reuse in CI. NB a reused server serves its *frozen* `.next-e2e` build — a
      // `next start` left listening on the port from a prior run means later runs skip the
      // rebuild and test stale code. The normal flow tears the server down between runs (so each
      // rebuilds); only a manually-left server goes stale — kill it if you changed app code.
      reuseExistingServer: !process.env.CI,
      env: {
        ...SERVER_ENV,
        // Keep `/crew/dev-code` live (isProdDeploy → false) exactly as on a Vercel preview, and
        // pin E2E_PROD so the build/start subprocess picks the `.next-e2e` distDir
        // (next.config.ts) instead of the operator's `.next`.
        VERCEL_ENV: "preview",
        E2E_PROD: "1",
        // #1007: the harness serves on E2E_PORT, and `appBaseUrl()`'s local-dev floor is
        // `http://localhost:3000` — the operator's port, not this one. So pin it, which is
        // exactly the rule the resolver states: a server on another port sets `APP_BASE_URL`.
        // No spec asserts the HOST of a minted link, so a wrong one would ship green.
        APP_BASE_URL: BASE_URL,
      },
    },
    ...(needsDevServer(process.argv)
      ? [
          {
            command: `npm run dev -- --port ${DEV_PORT}`,
            url: DEV_URL,
            // Compiles lazily; no build to wait for.
            timeout: 120_000,
            reuseExistingServer: !process.env.CI,
            env: {
              ...SERVER_ENV,
              // Its own build dir, `.next-e2e-dev` (next.config.ts) — and so its own dev lock.
              E2E_DEV: "1",
              APP_BASE_URL: DEV_URL,
            },
          },
        ]
      : []),
  ],
});
