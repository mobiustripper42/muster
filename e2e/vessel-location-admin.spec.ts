/**
 * Vessel + Location admin (task 12.9) — the settings twins. Domain validation is unit-tested
 * (src/admin/{vessel,location}-admin.test.ts); here we drive the SURFACES end to end: the
 * forms post, the saved values persist, and a vessel's chosen home location comes from a
 * location created moments earlier. Runs desktop + 375px.
 *
 * The crew seed's vessel is "Hops" (`vessel-hops`); we target it by id so a second seeded
 * vessel can't shuffle the default selection.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("admin /admin/locations + /admin/vessels", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew"); // seeds vessel-hops; no locations yet
  });

  test("create a location, then set it as a vessel's home + change capacity and colour", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");

    // ── Create a location ────────────────────────────────────────────────────
    await page.goto("/admin/locations?sel=new");
    await page.fill('input[name="name"]', "East Bank");
    await page.fill('textarea[name="pickupDescription"]', "Flats East Bank, dock 3");
    await page.fill('input[name="pickupLink"]', "https://maps.google.com/?q=dock3");
    await page.fill('textarea[name="routeDescription"]', "Up the river and back");
    await page.getByRole("button", { name: "Create location" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByRole("link", { name: /East Bank/ })).toBeVisible();

    // ── Edit the seeded vessel: capacity, colour, home location ───────────────
    await page.goto("/admin/vessels?sel=vessel-hops");
    await expect(page.getByRole("heading", { name: "Hops" })).toBeVisible();
    await page.fill('input[name="coiMaxPax"]', "10");
    await page.locator('input[name="hue"][value="3"]').check({ force: true });
    await page.selectOption('select[name="homeLocationId"]', { label: "East Bank" });
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByText("Saved.")).toBeVisible();

    // Persisted: capacity + chosen hue + a home location survive a reload.
    await page.reload();
    await expect(page.locator('input[name="coiMaxPax"]')).toHaveValue("10");
    await expect(page.locator('input[name="hue"][value="3"]')).toBeChecked();
    await expect(page.locator('select[name="homeLocationId"]')).not.toHaveValue(""); // a home is set
  });

  test("create a brand-new vessel; it appears in the sidebar", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/vessels?sel=new");
    await page.fill('input[name="name"]', "Sunset");
    await page.fill('input[name="coiMaxPax"]', "12");
    await page.locator('input[name="hue"][value="2"]').check({ force: true });
    await page.getByRole("button", { name: "Create vessel" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByText("Saved.")).toBeVisible();
    // The new boat is now a row in the vessel list.
    await expect(page.getByRole("link", { name: /Sunset/ })).toBeVisible();
  });
});
