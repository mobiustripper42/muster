/**
 * Flow 4 (#65) — the suppression rule, the OTHER thing manual eyeballing kept
 * re-explaining. Both seeds loaded: the at-risk seed widens every captain pool,
 * so when Quint drops his seat there IS someone eligible → the engine re-asks,
 * the seat goes Asked, the shift goes Filling, and the board deliberately
 * SUPPRESSES Hops (a live ask in flight isn't yet a problem). The cockpit is
 * where the operator sees the true in-flight state.
 *
 * Same direct-to-card navigation as the regression spec, for the same reason.
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsCrew,
  signInAsAdmin,
} from "./fixtures.js";

test.describe("bail → re-ask + board suppression (both seeds)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew", "atrisk");
  });

  test("bail with an eligible pool re-asks, suppresses Hops from the board, cockpit shows the seat awaiting reply", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");

    await page.goto("/crew/shift/shift-soon");
    await page.getByText(/I can.t make it/).click();
    await page.getByRole("button", { name: "Drop this shift" }).click();
    await expect(page).toHaveURL(/\/crew\?bailed=/);

    await signInAsAdmin(page, "spink");

    // The suppression: a re-ask in flight keeps Hops OFF the board.
    await expect(page.locator("article", { hasText: "Hops" })).toHaveCount(0);

    // The cockpit carries the honest state: the captain seat is re-asked and
    // awaiting a reply (the shift badge itself stays Pending — the trip is >2wk
    // out, before its staffing horizon — so we assert the SEAT, which is the
    // thing the re-ask actually moved).
    await page.goto("/admin/shift/shift-soon");
    await expect(page.getByRole("heading", { name: /Hops/ })).toBeVisible();
    const captainSeat = page.locator("article", { hasText: "captain" });
    await expect(captainSeat).toContainText("Asked");
    await expect(captainSeat).toContainText("awaiting reply");
  });
});
