/**
 * Blocks registry (task 12.10, DEC-125) — drives /admin/blocks end to end: create a scoped
 * Location block (date + time window) and see it in the single registry with a server-computed
 * "removes N slots" impact; create a Vessel block over a range that overlaps the seeded
 * bookings and see the booked-trip CONFLICT surfaced (never silently cancelled — committed
 * state beats blocks); then Lift the location block and watch it disappear. Domain validation +
 * impact math are unit-tested (src/admin/block-admin.test.ts, src/reservations/block-impact.test.ts);
 * this is the surface. Runs desktop + 375px.
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

  test("create a location block (impact) + a conflicting vessel block, then lift", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/blocks");

    // ── A Location block on an owned day with no booking → pure "removes N" impact ──
    await page.locator('input[name="kind"][value="location"]').check({ force: true });
    await page.selectOption('select[name="locationId"]', { label: "Reservation Demo Dock" });
    await page.fill('input[name="date"]', "2026-08-11"); // owned, no booking that day
    await page.fill('input[name="startTime"]', "13:00");
    await page.fill('input[name="endTime"]', "18:00"); // covers all three departures
    await page.getByRole("button", { name: "Create block" }).click();
    await page.waitForURL(/saved=1/);

    // The location block row shows its impact ("… slots"), no conflict.
    const locRow = page.locator("div").filter({ hasText: "Reservation Demo Dock" }).last();
    await expect(locRow).toContainText("slots");

    // ── A Vessel block over Aug 11–14 → conflicts with BOTH seeded bookings ──
    await page.locator('input[name="kind"][value="vessel"]').check({ force: true });
    await page.selectOption('select[name="vesselId"]', { label: RESERVATION_DEMO.vesselName });
    await page.fill('input[name="startDate"]', RESERVATION_DEMO.vesselBlockWindow.start);
    await page.fill('input[name="endDate"]', RESERVATION_DEMO.vesselBlockWindow.end);
    await page.getByRole("button", { name: "Create block" }).click();
    await page.waitForURL(/saved=1/);

    // Its row surfaces the conflict count + summed fare ($549 + $439 = $988).
    await expect(page.getByText(/2 booked \(\$988\) conflict/)).toBeVisible();

    // ── Lift the location block: two-step confirm, then it's gone ──
    const liftRow = page.locator("div").filter({ hasText: "Reservation Demo Dock" }).last();
    await liftRow.getByRole("link", { name: "Lift" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await page.waitForURL(/lifted=1/);
    await expect(page.getByText("Reservation Demo Dock")).toHaveCount(0);

    // The vessel block (and its conflict) survives the lift.
    await expect(page.getByText(/2 booked \(\$988\) conflict/)).toBeVisible();
  });
});
