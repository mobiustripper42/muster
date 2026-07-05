/**
 * 9.7 + 9.8 (#233/#234) — the cockpit/a11y bundle and the low-polish tier.
 * Asserts the accessibility-shaped changes an eyeball pass would miss: the
 * manning selects' accessible names (WCAG 4.1.2), the Crewed-gate summary, the
 * whole-card stretched link (a click on card whitespace opens the pane), and
 * the tenant + vessel-local date in the AdminNav.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("cockpit polish (9.7/9.8)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("manning role selects carry accessible names; the Crewed-gate summary reads the seat math", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shift/shift-ar-regress");

    // Two same-shaped selects, two distinct accessible names (9.7).
    await expect(
      page.getByLabel("Role for the required hand"),
    ).toBeVisible();
    await expect(page.getByLabel("Role for the trainee seat")).toBeVisible();

    // Crewed-gate summary (9.8): Firkin's one required captain seat is Bailed.
    await expect(
      page.getByText(/0\/1 required seats confirmed — Crewed when all confirm/),
    ).toBeVisible();
  });

  test("the whole board card is a click target (stretched link), controls still tappable", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    // Click the card's whitespace (bottom-right corner, away from the
    // vessel-name link text) → the stretched link opens the pane. Positioned
    // locator click auto-scrolls (a raw mouse.click at page coords misses when
    // the card sits below the fold).
    const card = page
      .locator("div.relative", { has: page.getByText("Growler") })
      .first();
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    await card.click({ position: { x: box.width - 12, y: box.height - 8 } });
    await page.waitForURL(/sel=/);
    await expect(
      page.getByRole("heading", { level: 2, name: /^Growler/ }),
    ).toBeVisible();
  });

  test("the AdminNav names the tenant and today's vessel-local date", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    const nav = page.getByRole("navigation", { name: "Admin" });
    await expect(nav.getByText(/BrewBoat · \w{3}, \w{3} \d{1,2}/)).toBeVisible();
  });
});
