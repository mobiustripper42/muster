/**
 * Offering catalog admin (task 12.8, DEC-123) — drives /admin/offerings end to end: create
 * an offering through every section (details, schedule, pricing + a variation, gratuity,
 * add-ons), set it Live, reload to confirm persistence, then Hide it and confirm the DEC-123
 * soft-delete semantics — gone from the default list, back under "Show hidden". Domain
 * validation is unit-tested (src/admin/offering-admin.test.ts); this is the surface.
 * Runs desktop + 375px.
 *
 * The crew seed's vessel is "Hops" (`vessel-hops`); an offering needs a Location, so the
 * flow creates one first (same as the vessel-location spec).
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsAdmin,
  clickHydrated,
  selectOptionHydrated,
} from "./fixtures.js";

test.describe("admin /admin/offerings", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew"); // seeds vessel-hops; no locations, no offerings
  });

  test("create through all sections, go Live, persist, then Hide → Show hidden", async ({
    page,
  }) => {
    await signInAsAdmin(page, "eric");

    // ── An offering needs a launch Location — create one first ───────────────
    await page.goto("/admin/locations?sel=new");
    await page.fill('input[name="name"]', "East Bank");
    await page.fill('textarea[name="pickupDescription"]', "Flats East Bank, dock 3");
    await page.fill('textarea[name="routeDescription"]', "Up the river and back");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);

    // ── Add-ons are first-class now (#491): create one so it can be attached below ─
    await page.goto("/admin/add-ons?sel=new");
    await page.fill('input[name="label"]', "Extra hour");
    await page.fill('input[name="amount"]', "150.00");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);

    // ── Create the offering — every section ──────────────────────────────────
    await page.goto("/admin/offerings?sel=new");

    // Details: Live, name, description, location, minutes, vessel chip.
    await page.locator('input[name="status"][value="live"]').check({ force: true });
    await page.fill('input[name="name"]', "Sunset Cruise");
    await page.fill('textarea[name="description"]', "**NO Pedaling Required** — party pontoons.");
    await page.selectOption('select[name="locationId"]', { label: "East Bank" });
    await page.fill('input[name="tripLengthMinutes"]', "100");
    await page.fill('input[name="holdMinutes"]', "100");
    await page.fill('input[name="arriveBeforeMinutes"]', "15");
    await page.locator('input[name="vesselIds"][value="vessel-hops"]').check({ force: true });

    // Schedule: season, days, two departure times via the island (add-multiple-in-one-pass).
    await page.fill('input[name="seasonStart"]', "2026-05-01");
    await page.fill('input[name="seasonEnd"]', "2026-09-30");
    await page.locator('input[name="weekday"][value="4"]').check({ force: true }); // Fri
    await page.locator('input[name="weekday"][value="5"]').check({ force: true }); // Sat
    // Islands throughout (#642): the selects are CONTROLLED, so a pre-hydration
    // selection is reverted when React asserts its own value, and the Add click is a
    // no-op until the handler is attached.
    await selectOptionHydrated(page.getByLabel("New departure hour"), "11");
    await selectOptionHydrated(page.getByLabel("New departure minute"), "30");
    await clickHydrated(page.getByRole("button", { name: "+ Add time" }));
    await selectOptionHydrated(page.getByLabel("New departure hour"), "15");
    await selectOptionHydrated(page.getByLabel("New departure minute"), "00");
    await clickHydrated(page.getByRole("button", { name: "+ Add time" }));

    // Pricing: base + included + extra guest + one ordered variation (the client island).
    await page.fill('input[name="basePrice"]', "499.00");
    await page.fill('input[name="includedGuestCount"]', "10");
    await page.fill('input[name="extraGuestPrice"]', "40.00");
    await clickHydrated(page.getByRole("button", { name: "+ Price variation" }));
    await page.getByLabel("Variation 1 label").fill("July 4th");
    await page.getByLabel("Variation 1 applies").selectOption("date");
    await page.getByLabel("Variation 1 date").fill("2026-07-04");
    // A discount — a negative adjustment. Exercises the string-buffered numeric input
    // (leading minus, no un-removable leading 0).
    await page.getByLabel("Variation 1 dollars").fill("-50");

    // Gratuity: the rendered defaults (pre required + post optional, 15/20/25) stand.
    await expect(page.locator('input[name="gratPre"]')).toBeChecked();
    await expect(page.locator('input[name="gratPreRequired"]')).toBeChecked();
    await expect(page.locator('input[name="gratPostRequired"]')).not.toBeChecked();

    // Add-ons: attach the shared "Extra hour" add-on via its checkbox (id is minted, so
    // target it through its label text).
    await page.locator('label:has-text("Extra hour") input[name="addOnIds"]').check({ force: true });

    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);

    // ── Persistence: a fresh load shows every section's saved values ─────────
    // (A clean URL — no lingering `saved=1` — so the next save's waitForURL is real.
    // The default list selects the first visible offering: ours.)
    await page.goto("/admin/offerings");
    await expect(page.locator('input[name="name"]')).toHaveValue("Sunset Cruise");
    await expect(page.locator('input[name="status"][value="live"]')).toBeChecked();
    await expect(page.locator('input[name="tripLengthMinutes"]')).toHaveValue("100");
    await expect(page.locator('select[name="locationId"] option:checked')).toHaveText("East Bank");
    await expect(page.locator('input[name="vesselIds"][value="vessel-hops"]')).toBeChecked();
    await expect(page.locator('input[name="weekday"][value="4"]')).toBeChecked();
    await expect(page.locator('input[name="weekday"][value="5"]')).toBeChecked();
    await expect(page.locator('input[name="departureTime"][value="11:30"]')).toHaveCount(1);
    await expect(page.locator('input[name="departureTime"][value="15:00"]')).toHaveCount(1);
    await expect(page.locator('input[name="basePrice"]')).toHaveValue("499.00");
    await expect(page.locator('input[name="includedGuestCount"]')).toHaveValue("10");
    await expect(page.getByLabel("Variation 1 label")).toHaveValue("July 4th");
    await expect(page.getByLabel("Variation 1 dollars")).toHaveValue("-50"); // discount round-trips
    await expect(
      page.locator('label:has-text("Extra hour") input[name="addOnIds"]'),
    ).toBeChecked(); // the attached add-on survives a reload

    // ── Hide it: DEC-123 reversible soft-delete ──────────────────────────────
    await page.locator('input[name="status"][value="hidden"]').check({ force: true });
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/saved=1/);

    // Default admin list: the hidden offering is gone…
    await page.goto("/admin/offerings");
    await expect(page.getByRole("link", { name: /Sunset Cruise/ })).not.toBeVisible();
    // …and returns under Show hidden, still fully intact.
    await page.getByRole("link", { name: /Show hidden/ }).click();
    await expect(page.getByRole("link", { name: /Sunset Cruise/ })).toBeVisible();
    await page.getByRole("link", { name: /Sunset Cruise/ }).click();
    await expect(page.locator('input[name="status"][value="hidden"]')).toBeChecked();
    await expect(page.locator('input[name="name"]')).toHaveValue("Sunset Cruise");
  });
});
