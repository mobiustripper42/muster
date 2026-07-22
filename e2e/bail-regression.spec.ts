/**
 * Flow 3 (#65) — reframed by DEC-128 (#483). Crew-only seed: Quint is the only
 * captain, so dropping his confirmed seat leaves nobody eligible. `shift-soon` is
 * **>2wk out — before its staffing horizon** (see the sibling reask spec), so the
 * old inline pool-blast that would have rested the seat `Bailed` and boarded Hops
 * as a "late bail" was exactly the #483 bug: staffing a shift weeks early. Post
 * DEC-128 the bail rests the seat **Open** and defers to the tick, which abstains
 * pre-horizon → the shift resolves **Pending, silent, off the board**. This spec
 * now pins that fix: a far-out only-captain bail must NOT alarm the operator.
 *
 * Navigates straight to the shift-card URL rather than clicking through My shifts
 * — the bail only needs the seat Confirmed, so this stays robust if the seed's
 * fixed-date shift ever drops out of the upcoming list.
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsCrew,
  signInAsAdmin,
} from "./fixtures.js";

test.describe("bail → pre-horizon deferral, stays off the board (crew-only seed)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("far-out only-captain bail rests Open and leaves the board quiet — no late-bail alarm (#483)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");

    await page.goto("/crew/shift/shift-soon");
    await expect(page.getByRole("heading", { name: "Hops" })).toBeVisible();

    // "I can't make it…" is a closed <details>; open it, reveal the confirm
    // (#271: "Drop this shift" now gates the drop), then confirm.
    await page.getByText(/I can.t make it/).click();
    await page.getByText("Drop this shift", { exact: true }).click();
    await page.getByRole("button", { name: "Yes, drop this shift" }).click();

    // Calm off-the-shift confirmation back on /crew.
    await expect(page).toHaveURL(/\/crew\?bailed=/);
    await expect(page.getByText(/off the/i)).toBeVisible();

    // Operator board: the fix — Hops does NOT land, and no late-bail alarm fires.
    // Pre-horizon the engine abstains, so a bail weeks out is silent (#483).
    await signInAsAdmin(page, "spink");
    await expect(page.locator("article", { hasText: "Hops" })).toHaveCount(0);
    await expect(page.getByText(/late bail/)).toHaveCount(0);

    // The cockpit carries the honest state: the seat reopened to Open (never a
    // resting Bailed), awaiting the tick once the horizon opens.
    await page.goto("/admin/shift/shift-soon");
    const captainSeat = page.locator("article", { hasText: "captain" });
    await expect(captainSeat).toContainText("Open");
    await expect(captainSeat).not.toContainText("Bailed");
  });
});
