/**
 * Version tag (#187): the lower-right build-version stamp shows on the signed-in
 * MENU surfaces only — the /admin hub + /crew — and on no other page. It's
 * `aria-hidden` chrome, so it's located by text, not role. Build-time env
 * (NEXT_PUBLIC_APP_VERSION, forwarded from package.json in next.config) — the dev
 * server inlines it, so it renders `vX.Y.Z` (no commit hash off Vercel).
 */
import { test, expect, resetAndSeed, signInAsCrew, signInAsAdmin } from "./fixtures.js";

/** `v0.8.0` locally; `v0.8.0 (a1b2c3d)` on Vercel. Don't pin the number. */
const VERSION = /^v\d+\.\d+\.\d+( \([0-9a-f]{7}\))?$/;

test.describe("version tag", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("admin settings shows the version; another admin page does not", async ({ page }) => {
    // Moved off the hub with it (#603): Settings is the admin-side home for the build stamp.
    await signInAsAdmin(page, "eric"); // lands on /admin/at-risk
    await page.goto("/admin/settings");
    await expect(page.getByText(VERSION)).toBeVisible();

    // The whole point of mounting per-page (not in Shell): sub-pages stay clean.
    await page.goto("/admin/outbox");
    await expect(page.getByText(VERSION)).toHaveCount(0);
  });

  test("crew menu shows the version", async ({ page }) => {
    await signInAsCrew(page, "crew-quint"); // lands on /crew
    await expect(page.getByText(VERSION)).toBeVisible();
  });
});
