/**
 * Flow 3 (#65) — THE #64 false-alarm. Crew-only seed: Quint is the only captain,
 * so dropping his confirmed seat leaves nobody to re-ask → the seat rests Bailed
 * and the Hops shift lands on the at-risk board as a regression ("Lacking crew ·
 * late bail"). This is the state manual eyeballing got wrong (a contaminated DB
 * silently re-asks instead), so the harness pins it.
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

test.describe("bail → board regression (crew-only seed)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("only-captain bail rests Bailed and lands Hops on the board as a late bail", async ({
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

    // Operator board: Hops is now a regression.
    await signInAsAdmin(page, "spink");
    const hopsRow = page.locator("article", { hasText: "Hops" });
    await expect(hopsRow).toBeVisible();
    await expect(hopsRow.getByText(/Lacking crew.+late bail/)).toBeVisible();
    // Header tally corroborates it.
    await expect(page.getByText(/1 late bail/)).toBeVisible();
  });
});
