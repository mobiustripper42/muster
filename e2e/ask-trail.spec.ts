/**
 * Ask history (#331): the operator's browse surface over every ask the engine
 * fired. The atrisk seed fires a known spread — Lance declined ("Out"), Petra
 * accepted ("In"), plus silent/ghosted ones. Domain resolution + outcome logic is
 * unit-tested (src/admin/ask-trail.test.ts); here we drive the SURFACE: the list
 * renders, and the crew filter narrows it. Runs desktop + 375px.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("admin /admin/asks — ask history", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("lists fired asks with outcomes, reachable from the admin hub", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin");
    await page.getByRole("link", { name: /Ask history/ }).click();
    await page.waitForURL(/\/admin\/asks/);

    // Scope to the rows region — the filter dropdown also holds every crew name.
    const list = page.getByRole("region", { name: "Ask history" });
    // A declined ask (Lance → "Out") and an accepted one (Petra → "In") both show.
    await expect(list.locator("div", { hasText: "Lance" }).filter({ hasText: "Out" }).first()).toBeVisible();
    await expect(list.getByText("Petra").first()).toBeVisible();
  });

  test("crew filter narrows the list to one person", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/asks");
    const list = page.getByRole("region", { name: "Ask history" });
    await expect(list.getByText("Petra").first()).toBeVisible();

    await page.selectOption("#crew", { label: "Lance" });
    await page.getByRole("button", { name: "Filter" }).click();
    await page.waitForURL(/crew=/);

    await expect(list.getByText("Lance").first()).toBeVisible();
    await expect(list.getByText("Petra")).toHaveCount(0);
  });
});
