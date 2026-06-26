/**
 * Flow 5 (#65): from the at-risk board, a direct Nudge puts an ask in flight and
 * a calm "last action" notice confirms it. Pre-DEC-065 the nudge then HID the row
 * ("the engine's working it"); now a near-term uncrewed shift STAYS on the board
 * even mid-ask — the operator keeps sight of what's short near the dock (the pilot
 * "where did the shift go?" fix). Uses the at-risk seed's Firkin regression row,
 * which offers Marisol as a nudge target.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("at-risk board — nudge", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("nudging a candidate keeps the near-term row on the board (DEC-065) and confirms the ask is in flight", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await expect(
      page.getByRole("heading", { name: "Needs attention" }),
    ).toBeVisible();

    const firkin = page.locator("article", { hasText: "Firkin" });
    await expect(firkin).toBeVisible();

    await firkin.getByRole("button", { name: /Nudge Marisol/ }).click();

    // The ask is in flight — confirmed by the calm "last action" notice.
    await expect(page.getByText(/Last action: nudged Marisol/)).toBeVisible();
    // DEC-065: a near-term uncrewed shift stays on the board even with an ask in
    // flight — nudging no longer hides it (the pilot's "where did it go?" bug).
    await expect(page.locator("article", { hasText: "Firkin" })).toHaveCount(1);
  });
});
