/**
 * Blocks registry (task 12.10, DEC-125) — drives /admin/blocks end to end: create a scoped
 * Location block and see it in the registry with a server-computed "removes N slots" impact +
 * a booked-trip CONFLICT (committed state beats blocks — never silently cancelled); create a
 * Vessel block over the seeded bookings; select a block from the list to load it into the edit
 * panel (master-detail); then delete (Lift) it from the panel and watch it disappear. The kind
 * toggle swaps the Location/Vessel field sets (no-JS `:has()`). Domain validation + impact math
 * are unit-tested; this is the surface. Runs desktop + 375px.
 *
 * The `reservation` seed builds a LIVE offering + owned days + two materialized bookings on
 * vessel-brew-3 at the fixed dates exported as RESERVATION_DEMO, so the conflict count is real.
 */
import { RESERVATION_DEMO } from "../src/reservations/seed-reservation.js";
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("admin /admin/blocks", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation"); // live offering + owned days + 2 booked trips on Brew 3
  });

  test("create (impact + conflict), select-to-edit, then delete", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/blocks");

    // ── Create a Location block (Location is the default kind) — Aug 12 13:00–16:00 ──
    await page.selectOption('select[name="locationId"]', { label: "Reservation Demo Dock" });
    await page.fill('input[name="date"]', "2026-08-12");
    await page.fill('input[name="startTime"]', "13:00");
    await page.fill('input[name="endTime"]', "16:00");
    await page.getByRole("button", { name: "Create block" }).click();
    await page.waitForURL(/sel=/); // saved → the new block is selected into the edit panel

    // Its row shows impact ("… slot") + the booked conflict (13:30 booked; 15:30 open = removed).
    const locRow = page.getByTestId("block-row").filter({ hasText: "Reservation Demo Dock" });
    await expect(locRow).toContainText("slot");
    await expect(page.getByText(/1 booked \(\$549\) conflict/)).toBeVisible();

    // ── + New → a Vessel block over Aug 11–14 (kind toggle swaps to the vessel fields) ──
    await page.getByRole("link", { name: "+ New" }).click();
    await page.getByRole("button", { name: /Vessel/ }).click(); // kind toggle → vessel fields
    await page.selectOption('select[name="vesselId"]', { label: RESERVATION_DEMO.vesselName });
    await page.fill('input[name="startDate"]', RESERVATION_DEMO.vesselBlockWindow.start);
    await page.fill('input[name="endDate"]', RESERVATION_DEMO.vesselBlockWindow.end);
    await page.getByRole("button", { name: "Create block" }).click();
    await page.waitForURL(/sel=/);
    // Conflicts with BOTH seeded bookings ($549 + $439 = $988).
    await expect(page.getByText(/2 booked \(\$988\) conflict/)).toBeVisible();

    // ── Filter to Vessel only ──
    await page.getByRole("link", { name: "Vessel", exact: true }).click();
    await expect(page.getByTestId("block-row")).toHaveCount(1);
    await page.getByRole("link", { name: "All", exact: true }).click();
    await expect(page.getByTestId("block-row")).toHaveCount(2);

    // ── Select the location block from the list → it loads into the edit panel (prefilled) ──
    await page.getByTestId("block-row").filter({ hasText: "Reservation Demo Dock" }).click();
    await expect(page.locator('input[name="date"]')).toHaveValue("2026-08-12");
    await expect(page.locator('input[name="endTime"]')).toHaveValue("16:00");

    // ── Delete it from the panel (Lift) → gone from the registry ──
    await page.getByRole("button", { name: /Lift block \(delete\)/ }).click();
    await page.waitForURL((url) => !url.searchParams.has("sel"));
    await expect(page.getByTestId("block-row").filter({ hasText: "Reservation Demo Dock" })).toHaveCount(0);

    // The vessel block (and its conflict) survives.
    await expect(page.getByText(/2 booked \(\$988\) conflict/)).toBeVisible();
  });
});
