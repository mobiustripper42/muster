/**
 * Flow 4 (#65) — the suppression rule, the OTHER thing manual eyeballing kept
 * re-explaining. Both seeds loaded: the at-risk seed widens every captain pool,
 * so when Quint drops his seat there IS someone eligible → the engine re-asks and
 * the seat goes Asked. Hops stays OFF the board because the trip is **>2wk out,
 * before its staffing horizon** (resolves Pending — not yet worked) — NOT because
 * an ask is in flight: post-DEC-065 a live ask no longer suppresses a shift within
 * the 48h deadline. The cockpit is where the operator sees the true seat state.
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
    await page.getByText("Drop this shift", { exact: true }).click(); // reveal confirm (#271)
    await page.getByRole("button", { name: "Yes, drop this shift" }).click();
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

  test("#271: 'Drop this shift' reveals a confirm — one tap does NOT bail", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/shift/shift-soon");
    await page.getByText(/I can.t make it/).click();

    // Tapping "Drop this shift" reveals the confirm; it must not bail.
    await page.getByText("Drop this shift", { exact: true }).click();
    await expect(page).toHaveURL(/\/crew\/shift\/shift-soon/);
    await expect(page.getByRole("button", { name: "Yes, drop this shift" })).toBeVisible();

    // The confirm is what actually bails.
    await page.getByRole("button", { name: "Yes, drop this shift" }).click();
    await expect(page).toHaveURL(/\/crew\?bailed=/);
  });
});
