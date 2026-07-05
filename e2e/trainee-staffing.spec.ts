/**
 * 9.3 (#224, DEC-087) — staff a named person into a supernumerary/trainee seat.
 * Drives the whole loop through the cockpit: add a trainee seat → the picker
 * appears (trainee rule set — unrated is fine; the same-day-committed exclusion
 * is covered by the core suite) → Assign → occupant named on the line + the
 * DEC-084 "you're on" notice lands in the outbox → my-shifts shows the ride →
 * Take off seat → picker returns.
 */
import { test, expect, resetAndSeed, signInAsAdmin, signInAsCrew } from "./fixtures.js";

test.describe("trainee staffing (9.3, DEC-087)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("assign → named + notified + on my-shifts; take off → picker returns", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shift/shift-ar-regress");

    // 8.5: add the trainee seat.
    await page.getByRole("button", { name: "+ Trainee seat" }).click();
    await expect(page.getByText(/Added a trainee seat/)).toBeVisible();

    // 9.3: staff Marisol (uncommitted, MMC-good) into it.
    const picker = page.getByLabel("Trainee for this seat");
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: "Marisol" });
    await page.getByRole("button", { name: "Assign", exact: true }).click();

    await expect(
      page.getByText(/Marisol is riding this shift as a trainee/),
    ).toBeVisible();

    // DEC-084: the "you're on" notice landed in the operator outbox.
    await page.goto("/admin/outbox");
    await expect(page.getByText(/you.?re on the .*shift/i).first()).toBeVisible();

    // My-shifts: the rider sees the shift, provenance-badged (#196).
    await signInAsCrew(page, "crew-ar-sub");
    await expect(page.getByText(/Added for you/).first()).toBeVisible();

    // The ride's shift card has NO bail control (DEC-087 rail guard) — a ride
    // isn't a reliability commitment; the calm "tell the office" line instead.
    await page.getByText(/Added for you/).first().click();
    await expect(page.getByText(/riding this shift as a trainee/)).toBeVisible();
    await expect(page.getByText("I can’t make it…")).toHaveCount(0);

    // Unstaff: back as admin, take them off — notice + picker returns.
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shift/shift-ar-regress");
    await page.getByRole("button", { name: "Take off seat" }).click();
    await expect(
      page.getByText(/Took Marisol off the trainee seat/),
    ).toBeVisible();
    await expect(page.getByLabel("Trainee for this seat")).toBeVisible();
  });
});
