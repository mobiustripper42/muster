/**
 * Persistent admin nav (#174): the operator sees the bar on every admin surface,
 * the active link follows the route, and a signed-out visitor never sees operator
 * chrome. Runs at 375px too (the no-hamburger single-row AC).
 */
import { test, expect, resetAndSeed, signInAsCrew, signInAsAdmin } from "./fixtures.js";

test.describe("admin nav", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("admin sees the nav; the active link follows the route", async ({ page }) => {
    await signInAsAdmin(page, "spink"); // lands on /admin/at-risk
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Muster" })).toBeVisible();

    // At-Risk is the active link on the board.
    await expect(nav.getByRole("link", { name: "At-Risk" })).toHaveAttribute("aria-current", "page");

    // Navigate via the bar → the highlight moves.
    await nav.getByRole("link", { name: "Outbox" }).click();
    await page.waitForURL(/\/admin\/outbox/);
    await expect(nav.getByRole("link", { name: "Outbox" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "At-Risk" })).not.toHaveAttribute("aria-current", "page");
  });

  test("a signed-out visitor sees no operator nav", async ({ page }) => {
    await page.goto("/admin/at-risk");
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });

  test("a crew subject sees no admin nav", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/admin/at-risk");
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });
});
