/**
 * Flow 5 (#65): from the at-risk board, a direct Nudge puts an ask in flight —
 * so the row leaves the board (that's the engine working, the counterintuitive
 * "empty is success" again) and a calm "last action" notice confirms it. Uses
 * the at-risk seed's Firkin regression row, which offers Marisol as a nudge
 * target.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("at-risk board — nudge", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("nudging a candidate removes the row and confirms the ask is in flight", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await expect(
      page.getByRole("heading", { name: "Needs attention" }),
    ).toBeVisible();

    const firkin = page.locator("article", { hasText: "Firkin" });
    await expect(firkin).toBeVisible();

    await firkin.getByRole("button", { name: /Nudge Marisol/ }).click();

    await expect(page.getByText(/Last action: nudged Marisol/)).toBeVisible();
    await expect(page.locator("article", { hasText: "Firkin" })).toHaveCount(0);
  });
});
