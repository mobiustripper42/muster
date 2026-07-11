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
    // The default is the 7-day week — a today-only default would hide these upcoming shifts.
    // `exact` so "Week" doesn't also match the "Weekend" chip.
    await expect(
      page.getByRole("link", { name: "Week", exact: true }),
    ).toBeVisible();
    // Barrel is ~2 days out → visible only because the default reaches a week ahead.
    await expect(page.getByText("Barrel")).toBeVisible();
  });

  test("the '2 weeks out' and '30 days' quick filters resolve their windows (#321)", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    // Both new preset chips are present alongside the existing ones.
    const twoWeeks = page.getByRole("link", { name: "2 Weeks out" });
    const thirty = page.getByRole("link", { name: "30 Days" });
    await expect(twoWeeks).toBeVisible();
    await expect(thirty).toBeVisible();

    // 30 Days: preset carried in the URL; window reaches the ~2-day-out Barrel,
    // and the count line names the resolved scope.
    await thirty.click();
    await page.waitForURL(/preset=days30/);
    await expect(page.getByText(/· the next 30 days/)).toBeVisible();
    await expect(page.getByText("Barrel")).toBeVisible();

    // 2 Weeks out: days 8–15 — a forward bucket that starts the day after the 7-day
    // week ends, so the ~2-day-out Barrel day falls outside it (the window moved).
    await page.goto("/admin/shifts");
    await page.getByRole("link", { name: "2 Weeks out" }).click();
    await page.waitForURL(/preset=next8to15/);
    // Scope label (lowercase) shows in the count/empty line, distinct from the chip.
    await expect(page.getByText(/2 weeks out/).last()).toBeVisible();
    await expect(page.getByText("Barrel")).toHaveCount(0);
  });

  test("the crew filter narrows to one member's shifts and widens the window (#330)", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    // Gus is Confirmed on Growler (~4 days out); Bram is on Barrel (~2 days out).
    // Default 7-day week shows both vessels.
    await expect(page.getByText("Growler")).toBeVisible();
    await expect(page.getByText("Barrel")).toBeVisible();

    // The crew filter lives behind the "More filters" disclosure — open it first.
    await page.getByText("More filters").click();
    await page.getByLabel("Crew").selectOption({ label: "Gus" });
    await page.getByRole("button", { name: "Filter" }).click();

    // Crew rides the URL; a bare pick (no preset) widens to the full horizon so a
    // person-lookup never hides a later shift.
    await page.waitForURL(/crew=/);
    await expect(page.getByText(/· the next 45 days/)).toBeVisible();

    // Only Gus's shift survives — Growler stays, Barrel (Bram's) is gone.
    await expect(page.getByText("Growler")).toBeVisible();
    await expect(page.getByText("Barrel")).toHaveCount(0);

    // Bug fix: with a crew active, clicking "Week" narrows to a real 7-day window
    // and the caption says so — it must NOT read "the next 45 days" (the old bug
    // where crew + the default 7-day view widened because next7 had no explicit
    // preset). Gus's Growler shift (~4 days out) is inside the week.
    await page.getByRole("link", { name: "Week", exact: true }).click();
    await page.waitForURL(/preset=next7/);
    await expect(page.getByText(/· the next 7 days/)).toBeVisible();
    await expect(page.getByText(/· the next 45 days/)).toHaveCount(0);
    await expect(page.getByText("Growler")).toBeVisible();
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

  test("a multi-trip day reads 'start · N trips'; the per-trip detail lives in the cockpit", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    // Operator QA on 9.5: the list stays scannable — Barrel's two departures
    // collapse to one compact fact; a single-trip row keeps time · pax.
    const barrel = page.getByRole("link", { name: /Barrel/ }).first();
    await expect(barrel.getByText("11:00 AM · 2 trips")).toBeVisible();
    await expect(page.getByText(/\d+:\d+ [AP]M · \d+ pax/).first()).toBeVisible();

    // The cockpit keeps every trip, chip-per-trip, no aboard-total tail.
    await barrel.click();
    await page.waitForURL(/sel=/);
    await expect(page.getByText(/11:00 AM/).last()).toBeVisible();
    await expect(page.getByText(/6:00 PM · \d+ pax/)).toBeVisible();
    await expect(page.getByText(/aboard total/)).toHaveCount(0);
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
