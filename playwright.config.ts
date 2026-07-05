import { defineConfig, devices } from "@playwright/test";

/**
 * e2e harness config (#65, Phase 5.5). First browser-test tooling in the project.
 *
 * Two deliberate constraints:
 *  - **`next dev`, not `next start`.** `/crew/dev-link` is dev-only (404 in prod)
 *    and every flow signs in through it — a production server can't run these.
 *  - **A dedicated port (3100) + the throwaway `muster_test` DB.** The app under
 *    test must never reuse a running `npm run dev` (that one points at muster_dev);
 *    the dedicated port keeps the two from colliding and the test DB from leaking
 *    into dev data.
 *
 * Single worker: the specs reset+seed one shared test DB in beforeEach, which is
 * only deterministic if they don't overlap.
 */

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
      // fixed corner version tag (version-tag — must clear content at 375px), and
      // the crew self-serve sign-in form + code entry (crew-sign-in — DEC-081).
      name: "mobile",
      testMatch: /(auth-crew|admin-nav|outbox-relay|crew-messaging|operator-messaging|version-tag|crew-sign-in|crew-open|crew-reconciliation)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    // Safe to reuse locally because the port is e2e-dedicated (only ever an
    // e2e/test-DB server). Never reuse in CI.
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
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
    },
  },
});
