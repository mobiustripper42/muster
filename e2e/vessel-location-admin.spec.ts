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
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByRole("link", { name: /East Bank/ })).toBeVisible();

    // ── Edit the seeded vessel: capacity, colour, home location ───────────────
    await page.goto("/admin/vessels?sel=vessel-hops");
    await expect(page.getByRole("heading", { name: "Hops" })).toBeVisible();
    await page.fill('input[name="coiMaxPax"]', "10");
    await page.locator('input[name="hue"][value="3"]').check({ force: true });
    await page.selectOption('select[name="homeLocationId"]', { label: "East Bank" });
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/saved=1/);

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
    // Required since #861 — a boat cannot be created without saying who sails it. The form opens
    // on one blank row, so this picks a role rather than adding one.
    await page.selectOption('select[name="crewRole"]', "role-captain");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);
    // The new boat is now a row in the vessel list.
    await expect(page.getByRole("link", { name: /Sunset/ })).toBeVisible();
  });

  test("a new vessel cannot be created without a required-crew role (#861)", async ({ page }) => {
    // The guard this screen exists for. Before #861 this save succeeded and produced a boat that
    // derived no seats — no ask, no At-Risk row, not claimable — and since #863 one that throws.
    // Native `required` blocks the submit first, so the server refusal is reached by removing the
    // attribute: both layers matter and only one of them is a real guard.
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/vessels?sel=new");
    await page.fill('input[name="name"]', "Crewless");
    await page.fill('input[name="coiMaxPax"]', "12");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page).not.toHaveURL(/saved=1/);

    await page.locator('select[name="crewRole"]').evaluate((el) => el.removeAttribute("required"));
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/err=crew_required/);
    await expect(page.getByText(/who has to be aboard to sail it/i)).toBeVisible();
  });

  test("adding a crew row keeps what was already typed (#861)", async ({ page }) => {
    // Add is a form POST on a surface with no client JS, so the round trip goes through the draft
    // cookie. Losing the half-typed name is the failure that shape invites.
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/vessels?sel=new");
    await page.fill('input[name="name"]', "Half-typed");
    await page.getByRole("button", { name: "+ Add a role" }).click();
    await page.waitForURL(/crew=1/);

    await expect(page.locator('select[name="crewRole"]')).toHaveCount(2);
    await expect(page.locator('input[name="name"]')).toHaveValue("Half-typed");
  });
});
