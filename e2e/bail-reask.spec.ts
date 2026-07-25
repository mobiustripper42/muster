/**
 * Flow 4 (#65) — board suppression + the DEC-128 (#483) deferral. Both seeds
 * loaded: the at-risk seed widens every captain pool, so when Quint drops his
 * seat there IS someone eligible — but post-DEC-128 the bail no longer re-asks
 * inline: it rests the seat **Open** and leaves re-crewing to the tick. Hops
 * stays OFF the board because the trip is **>2wk out, before its staffing
 * horizon** (resolves Pending — not yet worked). The cockpit shows the reopened
 * Open seat; the tick (not the bail) will drip an ask once the horizon opens.
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

  test("bail rests the seat Open (no inline re-ask), keeps Hops off the board, cockpit shows the reopened seat", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");

    await page.goto("/crew/shift/shift-soon");
    await page.getByText(/I can.t make it/).click();
    await page.getByText("Drop this shift", { exact: true }).click(); // reveal confirm (#271)
    await page.getByRole("button", { name: "Yes, drop this shift" }).click();
    await expect(page).toHaveURL(/\/crew\?bailed=/);

    await signInAsAdmin(page, "spink");

    // Pre-horizon (>2wk out): the shift resolves Pending and stays OFF the board.
    await expect(page.locator("article", { hasText: "Hops" })).toHaveCount(0);

    // The cockpit carries the honest state: the bail reopened the captain seat to
    // **Open** and fired NO ask (DEC-128 #483) — the tick re-crews once the horizon
    // opens. So the seat pill reads Open, not Asked, and nobody is "awaiting reply".
    await page.goto("/admin/shift/shift-soon");
    await expect(page.getByRole("heading", { name: /Hops/ })).toBeVisible();
    const captainSeat = page.locator("article", { hasText: "captain" });
    await expect(captainSeat).toContainText("Open");
    await expect(captainSeat).not.toContainText("Asked");
    await expect(captainSeat).not.toContainText("awaiting reply");
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
