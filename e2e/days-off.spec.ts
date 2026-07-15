/**
 * Recurring weekday-off (#426, DEC-119): a crew member checks the weekdays they
 * never work — folded into /crew/time-off as its second section. Domain rule + CLI
 * are unit-tested (src/oracle/eligibility.test.ts, src/crew/crew-cli.test.ts); here
 * we drive the crew SURFACE end to end — the checkbox form posts, replaces the whole
 * set, and persists. Runs desktop + 375px.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew /crew/time-off — weekdays I never work", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("check weekdays, save, and see them persist", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time-off");

    // Empty to start — nothing checked.
    await expect(page.locator("#day-5")).not.toBeChecked(); // Saturday
    await expect(page.locator("#day-6")).not.toBeChecked(); // Sunday

    // Never Saturdays or Sundays. "Save" is the weekday form (distinct from "Add").
    await page.locator("#day-5").check();
    await page.locator("#day-6").check();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByText(/recurring days off are updated/i)).toBeVisible();

    // Persisted — a fresh load shows them still checked, Monday untouched.
    await page.goto("/crew/time-off");
    await expect(page.locator("#day-5")).toBeChecked();
    await expect(page.locator("#day-6")).toBeChecked();
    await expect(page.locator("#day-0")).not.toBeChecked(); // Monday
  });

  test("unchecking all and saving clears the set (whole-set replace)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time-off");

    // Set Sunday, save.
    await page.locator("#day-6").check();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.locator("#day-6")).toBeChecked();

    // Uncheck and save → cleared (unchecked boxes submit nothing).
    await page.locator("#day-6").uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.locator("#day-6")).not.toBeChecked();
  });
});
