/**
 * Crew audit trail (#400, DEC-118): /admin/asks is now the one list of every
 * crew event — asked / in / out / added / removed / bailed / …, sourced from the
 * reliability + audit logs. The atrisk seed logs exactly one such event (Cody
 * bailed → a "Bailed" row); the seed's declined/accepted ASKS are plain Ask rows,
 * not reliability events, so they don't land here. Row/kind mapping is unit-tested
 * (src/admin/audit-trail.test.ts); here we drive the SURFACE: the list renders and
 * the crew filter narrows it. Runs desktop + 375px.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("admin /admin/asks — crew audit trail", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("lists crew events with kinds, reachable from the admin hub", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin");
    await page.getByRole("link", { name: /Audit/ }).click();
    await page.waitForURL(/\/admin\/asks/);

    // Scope to the rows region — the filter dropdown also holds every crew name.
    const list = page.getByRole("region", { name: "Audit trail" });
    // Cody bailed → a "Bailed" row (the seed's one logged reliability event).
    await expect(list.locator("div", { hasText: "Cody" }).filter({ hasText: "Bailed" }).first()).toBeVisible();
  });

  test("crew filter narrows the list to one person", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/asks");
    const list = page.getByRole("region", { name: "Audit trail" });
    await expect(list.getByText("Cody").first()).toBeVisible();

    // Filter to a crew with no logged events → Cody's row drops out.
    await page.selectOption("#crew", { label: "Lance" });
    await page.getByRole("button", { name: "Filter" }).click();
    await page.waitForURL(/crew=/);

    await expect(list.getByText("Cody")).toHaveCount(0);
  });
});
