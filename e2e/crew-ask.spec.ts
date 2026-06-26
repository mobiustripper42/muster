/**
 * Flow 2 (#65): the In/Out tap. In confirms the seat (DEC-061 auto-confirm) → it
 * joins My shifts as a confirmed (clickable) shift and the ask card clears. Out
 * declines → the card clears with no new shift. Both assert the ask is *gone*
 * afterward (the tap landed).
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew ask — In / Out", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("In auto-confirms the seat → My shifts shows it as a confirmed shift", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByText("In or out?")).toBeVisible();

    await page.getByRole("button", { name: "In" }).click();

    // Auto-confirm (DEC-061): the "In" locks the seat immediately — no operator
    // confirm step — so `shift-ask` joins My shifts as a confirmed, clickable row,
    // never an "awaiting confirmation" placeholder.
    await expect(page.locator('a[href="/crew/shift/shift-ask"]')).toBeVisible();
    await expect(page.getByText("Awaiting confirmation")).toHaveCount(0);
    // …and the ask is answered, so the card is gone.
    await expect(page.getByText("In or out?")).toHaveCount(0);
  });

  test("Out declines → the ask card clears, no new shift", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByText("In or out?")).toBeVisible();

    await page.getByRole("button", { name: "Out" }).click();

    await expect(page.getByText("In or out?")).toHaveCount(0);
    await expect(page.getByText("Awaiting confirmation")).toHaveCount(0);
  });
});
