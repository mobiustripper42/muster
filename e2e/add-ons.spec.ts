/**
 * Add-ons as first-class entities (#491) — drives /admin/add-ons end to end, then confirms an
 * add-on created there shows up in the /admin/offerings picker, attaches, and persists across a
 * reload. Domain validation is unit-tested (src/admin/add-on-admin.test.ts); this is the
 * surface + the offering-attachment round-trip. Runs desktop + 375px.
 *
 * The crew seed's vessel is "Hops" (`vessel-hops`); an offering needs a Location, so the flow
 * creates one first (same as the offering-catalog spec).
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("admin /admin/add-ons", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew"); // seeds vessel-hops; no locations, offerings, or add-ons
  });

  test("create an add-on, attach it on an offering, and it persists", async ({ page }) => {
    await signInAsAdmin(page, "spink");

    // ── Create an add-on ──────────────────────────────────────────────────────
    await page.goto("/admin/add-ons?sel=new");
    await page.fill('input[name="label"]', "Extra hour");
    await page.fill('input[name="amount"]', "150.00");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByRole("link", { name: /Extra hour/ })).toBeVisible();

    // Persists as its own row: a fresh load shows the saved fields.
    await page.goto("/admin/add-ons");
    await expect(page.locator('input[name="label"]')).toHaveValue("Extra hour");
    await expect(page.locator('input[name="amount"]')).toHaveValue("150.00");
    await expect(page.locator('input[name="active"]')).toBeChecked();

    // ── An offering needs a launch Location ───────────────────────────────────
    await page.goto("/admin/locations?sel=new");
    await page.fill('input[name="name"]', "East Bank");
    await page.fill('textarea[name="pickupDescription"]', "Flats East Bank, dock 3");
    await page.fill('textarea[name="routeDescription"]', "Up the river and back");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);

    // ── Create an offering and ATTACH the add-on via its picker checkbox ───────
    await page.goto("/admin/offerings?sel=new");
    await page.locator('input[name="status"][value="live"]').check({ force: true });
    await page.fill('input[name="name"]', "Sunset Cruise");
    await page.selectOption('select[name="locationId"]', { label: "East Bank" });
    await page.locator('input[name="vesselIds"][value="vessel-hops"]').check({ force: true });
    await page.fill('input[name="seasonStart"]', "2026-05-01");
    await page.fill('input[name="seasonEnd"]', "2026-09-30");
    await page.locator('input[name="weekday"][value="5"]').check({ force: true }); // Sat
    await page.fill('input[name="basePrice"]', "499.00");
    await page.fill('input[name="extraGuestPrice"]', "40.00");

    // The add-on appears in the picker (label + amount) and attaches by checkbox.
    const addOnCheckbox = page.locator('label:has-text("Extra hour") input[name="addOnIds"]');
    await expect(addOnCheckbox).toHaveCount(1);
    await addOnCheckbox.check({ force: true });

    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);

    // ── Persistence: reload → the add-on is still checked ─────────────────────
    await page.goto("/admin/offerings");
    await expect(page.locator('input[name="name"]')).toHaveValue("Sunset Cruise");
    await expect(
      page.locator('label:has-text("Extra hour") input[name="addOnIds"]'),
    ).toBeChecked();
  });
});
