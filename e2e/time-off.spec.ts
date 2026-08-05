/**
 * Time-off surfaces (#332): crew add/remove their own blackout dates, and the
 * operator's view-plus-set of everyone's. Domain validation/ownership is unit-
 * tested (src/crew/time-off.test.ts); here we drive the SURFACE end to end — the
 * forms post, the list reflects it, the remove clears it. Runs desktop + 375px.
 */
import { test, expect, resetAndSeed, signInAsCrew, signInAsAdmin } from "./fixtures.js";

test.describe("crew /crew/time-off — my days off", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("add a window from the crew home link, see it, then remove it", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew");
    // Via the drawer since #644 — the hub's "Time off" card moved there.
    await page.locator(`summary[aria-label="Open menu"]`).click();
    await page.getByRole("link", { name: "Time off" }).click();
    await page.waitForURL(/\/crew\/time-off/);

    // Empty to start.
    await expect(page.getByText(/available for asks on every date/i)).toBeVisible();

    // Add a same-day window.
    await page.fill("#start", "2026-08-15");
    await page.fill("#end", "2026-08-15");
    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL(/added=1/);
    await expect(page.getByText(/Aug 15/)).toBeVisible();

    // Remove it → back to empty.
    await page.getByRole("button", { name: "Remove" }).click();
    await page.waitForURL(/removed=1/);
    await expect(page.getByText(/available for asks on every date/i)).toBeVisible();
  });

  test("an inverted range is refused with calm copy, nothing added", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time-off");
    await page.fill("#start", "2026-08-20");
    await page.fill("#end", "2026-08-10");
    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL(/err=end_before_start/);
    await expect(page.getByText(/end date is before the start/i)).toBeVisible();
    await expect(page.getByText(/available for asks on every date/i)).toBeVisible();
  });
});

test.describe("admin /admin/time-off — set & scan crew time off", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("operator sets a crew member out, sees it grouped under their name, removes it", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/time-off");
    await expect(page.getByText(/everyone’s available/i)).toBeVisible();

    // Put Quint out for a span.
    await page.selectOption("#crewMemberId", { label: "Quint" });
    await page.fill("#start", "2026-09-01");
    await page.fill("#end", "2026-09-05");
    await page.getByRole("button", { name: "Add time off" }).click();
    await page.waitForURL(/added=1/);

    // Grouped under Quint, showing the span.
    const card = page.locator("div", { hasText: "Quint" }).filter({ hasText: "Sep 1" });
    await expect(card.first()).toBeVisible();

    // Remove it.
    await page.getByRole("button", { name: "Remove" }).click();
    await page.waitForURL(/removed=1/);
    await expect(page.getByText(/everyone’s available/i)).toBeVisible();
  });
});
