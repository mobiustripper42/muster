/**
 * Flow 2 (#65): the In/Out tap. In claims the seat → it shows in My shifts as
 * awaiting confirmation and the ask card clears. Out declines → the card clears
 * with no new shift. Both assert the ask is *gone* afterward (the tap landed).
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew ask — In / Out", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("In claims the seat → My shifts shows it awaiting confirmation", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByText("In or out?")).toBeVisible();

    await page.getByRole("button", { name: "In" }).click();

    // A claimed-but-unconfirmed seat renders as the awaiting-confirmation row…
    await expect(page.getByText("Awaiting confirmation")).toBeVisible();
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
