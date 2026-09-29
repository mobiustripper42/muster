/**
 * /admin/waivers (Phase 18.2, issue #1116). The rules — when a version takes effect, the lock,
 * one version per future day, settings validation — are unit-tested in
 * `src/checkin/waiver-admin.test.ts`; here we drive the SURFACE: the forms post, the page shows
 * each version in the right place, and a version in effect offers no way to change it.
 * Runs desktop + 375px.
 */
import { test, expect, plantWaiverTemplate, resetAndSeed, signInAsAdmin } from "./fixtures.js";

const LATER = "2030-01-15";

test.describe("admin /admin/waivers", () => {
  test.beforeEach(async () => {
    await resetAndSeed();
  });

  test("post the first version dated today; it is in effect at once and the form refills with it", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/waivers");
    await expect(page.getByText("No waiver posted yet.")).toBeVisible();

    await page.fill('input[name="version"]', "brewboat-2026-v1");
    await page.fill('textarea[name="body"]', "Voyage Agreement\n\nI accept the risks.");
    await page.getByRole("button", { name: "Post version" }).click();
    await page.waitForURL(/saved=posted/);

    const inEffect = page.locator("section", { has: page.getByRole("heading", { name: "In effect now" }) });
    await expect(inEffect.getByText("brewboat-2026-v1")).toBeVisible();
    await expect(inEffect.getByText("I accept the risks.")).toBeVisible();
    // A typo fix starts from the words in force.
    await expect(page.locator('textarea[name="body"]')).toHaveValue("Voyage Agreement\n\nI accept the risks.");
  });

  test("schedule a future version, then edit it before it takes effect", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/waivers");
    await page.fill('input[name="version"]', "brewboat-2030-v1");
    await page.fill('input[name="effectiveDate"]', LATER);
    await page.fill('textarea[name="body"]', "Words with a tpyo.");
    await page.getByRole("button", { name: "Post version" }).click();
    await page.waitForURL(/saved=posted/);

    // Scheduled, not in effect.
    await expect(page.getByText("No waiver posted yet.")).toBeVisible();
    await expect(page.getByText(/Takes effect Jan 15, 2030/)).toBeVisible();

    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await page.waitForURL(/edit=/);
    await expect(page.locator('textarea[name="body"]')).toHaveValue("Words with a tpyo.");
    await page.fill('textarea[name="body"]', "Words with a typo fixed.");
    await page.fill('input[name="version"]', "brewboat-2030-v1b");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/saved=edited/);

    await expect(page.getByText("brewboat-2030-v1b")).toBeVisible();
    await expect(page.getByText(/Takes effect Jan 15, 2030/)).toHaveCount(1);
  });

  test("a second version for the same future day is refused, and what was typed is kept", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/waivers");
    for (const label of ["first", "second"]) {
      await page.fill('input[name="version"]', label);
      await page.fill('input[name="effectiveDate"]', LATER);
      await page.fill('textarea[name="body"]', `The ${label} words.`);
      await page.getByRole("button", { name: "Post version" }).click();
      await page.waitForURL(label === "first" ? /saved=posted/ : /err=date_taken/);
    }
    await expect(page.getByText(/already scheduled for that day/)).toBeVisible();
    await expect(page.locator('input[name="version"]')).toHaveValue("second");
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(1);
  });

  test("a version in effect has no Edit, and asking to edit it by URL is refused", async ({ page }) => {
    await plantWaiverTemplate({
      id: "wt-live",
      version: "brewboat-2026-v0",
      body: "Signed words.",
      effectiveFrom: "2026-01-01T05:00:00.000Z",
    });
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/waivers");
    const inEffect = page.locator("section", { has: page.getByRole("heading", { name: "In effect now" }) });
    await expect(inEffect.getByText("Signed words.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

    await page.goto("/admin/waivers?edit=wt-live");
    await expect(page.getByText(/can’t be edited/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Post version" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  });

  test("save the settings; a bad reminder list is refused", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/waivers");
    await expect(page.locator('input[name="ageOfMajority"]')).toHaveValue("18");
    await expect(page.locator('input[name="reminderDays"]')).toHaveValue("7, 3, 1");

    await page.fill('input[name="ageOfMajority"]', "21");
    await page.fill('input[name="reminderDays"]', "1 5 5");
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.waitForURL(/saved=settings/);
    await expect(page.locator('input[name="ageOfMajority"]')).toHaveValue("21");
    await expect(page.locator('input[name="reminderDays"]')).toHaveValue("5, 1");

    await page.fill('input[name="reminderDays"]', "7, soon");
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.waitForURL(/err=bad_reminder_days/);
    await expect(page.getByText(/whole numbers of days/)).toBeVisible();
    await expect(page.locator('input[name="reminderDays"]')).toHaveValue("7, soon");
  });
});
