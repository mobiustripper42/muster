/**
 * #250 — global navigation loading bar. Clicking any internal link/row shows a
 * slim accent bar at the top of the viewport until the next page/pane lands. It has
 * a minimum display time, so it's visible even on a fast navigation (the per-link
 * spinner it replaced flashed by too quickly). The counterpart to <SubmitButton>'s
 * in-flight spinner for form submits.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const plusDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const board = () => `/admin/shifts?from=${today()}&to=${plusDays(10)}`;

test.describe("nav loading bar (#250)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("clicking a row shows the loading bar (visible even on a fast nav), then clears", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(board());

    // At rest, no bar.
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);

    // Click a row — NO forced network delay. The bar must still appear (it triggers
    // on the click and holds for its minimum display window).
    await page.getByRole("link", { name: /Firkin/ }).click();
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();

    // The pane lands...
    await page.waitForURL(/sel=shift-ar-regress/);
    await expect(
      page.getByRole("heading", { level: 2, name: /^Firkin/ }),
    ).toBeVisible();
    // ...and the bar clears once the min-display window elapses.
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, {
      timeout: 3000,
    });
  });
});
