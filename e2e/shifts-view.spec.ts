/**
 * 8.2a (#205) — the Builder View mode on `/admin/shifts`. Two behaviours:
 *  1. the default window is the **next 7 days** (not today-only, DEC-042's old
 *     default) — the operator's "what's coming up" for the pilot;
 *  2. a shift whose trips span a large mid-day gap carries a calm read-only
 *     "could be two shifts" cue (8.1/#204) — advisory, neutral, no action here.
 *
 * Seed: `atrisk` scenario H (Barrel, 11:00 + 18:00 ~2d out) is the gappy day; the
 * other scenarios are single-trip or contiguous, so exactly one cue renders.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("builder view — /admin/shifts (8.2a)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("defaults to the next 7 days and shows upcoming shifts (not just today)", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts"); // no params → the default window

    await expect(page.getByRole("heading", { name: "All shifts" })).toBeVisible();
    // The default is Next 7 days — a today-only default would hide these upcoming shifts.
    await expect(page.getByRole("link", { name: "Next 7 days" })).toBeVisible();
    // Barrel is ~2 days out → visible only because the default reaches a week ahead.
    await expect(page.getByText("Barrel")).toBeVisible();
  });

  test("renders a calm split cue on a large-gap day", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    // Barrel's 11:00 + 18:00 (7h apart) → the advisory cue; only the gappy day gets it.
    await expect(page.getByText(/could be two shifts/).first()).toBeVisible();
    await expect(page.getByText(/could be two shifts/)).toHaveCount(1);
  });
});
