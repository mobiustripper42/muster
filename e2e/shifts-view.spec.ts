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
    // Import-diff cues (DEC-083 + 9.10) stay OFF with no import runs seeded —
    // the dev seeds aren't pulls, so nothing here is "new in the last pull".
    await expect(page.getByText(/new in the last pull/)).toHaveCount(0);
    await expect(page.getByText(/changed in the last pull/)).toHaveCount(0);
  });
});

/**
 * 9.6 (#232) — the board bundle: per-trip spans (the join("   ") run-on fix),
 * neutral-ink seat pips (role initial, filled vs open, dashed trainee), and the
 * DEC-086 vessel identity dot. All neutral/identity ink — no state color leaks
 * onto this surface (DEC-042 holds).
 */
test.describe("board bundle — /admin/shifts (9.6)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("a multi-trip day renders one span per trip, not a run-on string", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    // Barrel's two departures are separate nowrap spans — each time·pax fact
    // holds together at any width. The trips live inside the row link.
    const barrel = page.getByRole("link", { name: /Barrel/ }).first();
    await expect(barrel.getByText(/11:00 AM · \d+ pax/)).toBeVisible();
    await expect(barrel.getByText(/6:00 PM · \d+ pax/)).toBeVisible();
  });

  test("rows carry neutral-ink seat pips — filled for Confirmed, open otherwise", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    // Growler's captain seat is Confirmed → a filled pip; Firkin's is Bailed →
    // an open (outline) pip. Pips are title-labeled, never state-colored.
    await expect(page.locator('[title="captain · filled"]').first()).toBeVisible();
    await expect(page.locator('[title="captain · open"]').first()).toBeVisible();
  });

  test("every row leads with its vessel identity dot (DEC-086)", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    // One dot per row, hue keyed off the vessel id — identity, aria-hidden.
    const dots = page.locator('span[class*="bg-vessel-"]');
    const rows = page.locator('a[href*="sel="]');
    await expect(dots.first()).toBeVisible();
    expect(await dots.count()).toBe(await rows.count());
  });
});
