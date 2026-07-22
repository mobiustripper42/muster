/**
 * Day·Grid reservation calendar (task 12.11, #464) — drives /admin/calendar end to end.
 * Read-only slice: one day as fleet-vessel columns × a fixed 8:00–21:30 axis, each computed
 * departure a duration-spanning block (deriveVirtualAvailability, DEC-125).
 *
 * The `reservation` seed builds a LIVE offering + owned days (Aug 10–16) on Brew 3 with two
 * booked trips (RESERVATION_DEMO): Aug 12 13:30 Marcus Webb (party 8), Aug 13 15:30 Dana Cho.
 * So on 2026-08-12 Brew 3 shows one BOOKED block (Marcus Webb) + two OPEN blocks (15:30, 17:30
 * — the offering's other departures). The Booked filter hides the opens, keeps the booking.
 * Runs desktop + 375px (the grid scrolls; the booked block stays present).
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("admin /admin/calendar", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation"); // live offering + owned days + 2 booked trips on Brew 3
  });

  test("Day·Grid renders the day; Booked filter hides opens", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/calendar?date=2026-08-12");

    // Brew 3 has a column header.
    await expect(page.getByText("Brew 3", { exact: true })).toBeVisible();

    // The 13:30 booking renders as a booked block: customer + "1:30 · 8".
    const booked = page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" });
    await expect(booked).toBeVisible();
    await expect(booked).toContainText("1:30");
    await expect(booked).toContainText("8");

    // The offering's other two departures show as OPEN blocks (15:30, 17:30).
    await expect(page.getByText("open · 3:30")).toBeVisible();
    await expect(page.getByText("open · 5:30")).toBeVisible();

    // Filter → Booked: opens vanish, the booking stays.
    await page.getByTestId("filter-booked").click();
    await page.waitForURL(/filter=booked/);
    await expect(page.getByText("open · 3:30")).toHaveCount(0);
    await expect(page.getByText("open · 5:30")).toHaveCount(0);
    await expect(page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" })).toBeVisible();
  });
});
