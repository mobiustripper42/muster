/**
 * Persistent admin nav (#174): the operator sees the bar on every admin surface,
 * the active link follows the route, and a signed-out / crew visitor sees no
 * operator chrome. Responsive — desktop inline links, mobile hamburger → slide-in
 * drawer. Runs at desktop + 375px (the mobile drawer is exercised at 375).
 */
import { test, expect, resetAndSeed, signInAsCrew, signInAsAdmin } from "./fixtures.js";

/** On mobile the links live behind the hamburger; open it first. No-op on desktop. */
async function openMenuIfMobile(page: import("@playwright/test").Page): Promise<void> {
  const burger = page.getByRole("button", { name: "Open menu" });
  if (await burger.isVisible()) await burger.click();
}

test.describe("admin nav", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("admin navigates via the bar; the active link follows the route", async ({ page }) => {
    await signInAsAdmin(page, "spink"); // lands on /admin/at-risk
    const nav = page.getByRole("navigation", { name: "Admin" });
    await expect(nav.getByRole("link", { name: "Muster" })).toBeVisible();

    await openMenuIfMobile(page);
    await expect(nav.getByRole("link", { name: "At-Risk" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "Outbox" }).click(); // closes the drawer on mobile
    await page.waitForURL(/\/admin\/outbox/);

    await openMenuIfMobile(page);
    await expect(nav.getByRole("link", { name: "Outbox" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "At-Risk" })).not.toHaveAttribute("aria-current", "page");
  });

  test("9.12: the nav links the built Messages surface (#238)", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    const nav = page.getByRole("navigation", { name: "Admin" });
    await openMenuIfMobile(page);
    await nav.getByRole("link", { name: "Messages" }).click();
    await page.waitForURL(/\/admin\/messages/);
    await openMenuIfMobile(page);
    await expect(nav.getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
  });

  test("desktop: the nav fits the two-pane height budget (guards #253)", async ({ page }) => {
    // The two-pane board's independent-scroll layout (#253) bounds its shell to
    // `calc(100dvh - 3.25rem)` on lg, where 3.25rem (52px) is the budget for this
    // sticky nav. That constant lives in shell.tsx and can't see the nav; if the
    // nav ever outgrows 52px the calc under-subtracts and the #253 scroll-snap
    // quietly returns. This pins the budget so that change fails CI here instead.
    const width = page.viewportSize()?.width ?? 0;
    test.skip(width < 1024, "the fill-height budget only applies at lg (≥1024px)");
    await signInAsAdmin(page, "spink");
    const nav = page.getByRole("navigation", { name: "Admin" });
    const height = await nav.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(52); // 3.25rem — the shell.tsx cutoff
  });

  test("mobile: the hamburger toggles the drawer; a link tap navigates + closes it", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    const burger = page.getByRole("button", { name: "Open menu" });
    test.skip(!(await burger.isVisible()), "desktop: inline links, no hamburger");

    // Closed → open: aria-expanded is the reliable state signal (a transformed
    // off-screen drawer still reads "visible" to Playwright, so assert on this).
    await expect(burger).toHaveAttribute("aria-expanded", "false");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-expanded", "true");

    // The drawer's Shifts link is now on-screen + actionable; tapping it navigates.
    await page.getByRole("link", { name: "Shifts" }).click();
    await page.waitForURL(/\/admin\/shifts/);
    // …and the drawer closed itself on the route change.
    await expect(burger).toHaveAttribute("aria-expanded", "false");
  });

  test("a signed-out visitor sees no operator nav", async ({ page }) => {
    await page.goto("/admin/at-risk");
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });

  test("a crew subject sees no admin nav", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/admin/at-risk");
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });
});
