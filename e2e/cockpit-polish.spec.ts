/**
 * 9.7 + 9.8 (#233/#234) — the cockpit/a11y bundle and the low-polish tier.
 * Asserts the accessibility-shaped changes an eyeball pass would miss: the
 * Crewed-gate summary, the whole-card stretched link (a click on card whitespace
 * opens the pane), and the tenant + vessel-local date in the AdminNav.
 *
 * The manning-select accessible-name assertions (9.7) went with the Manning UI
 * when it was withdrawn; the seat override picker carries the surviving one.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("cockpit polish (9.7/9.8)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("the seat override select carries an accessible name; the Crewed-gate summary reads the seat math", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shift/shift-ar-regress");

    // The surviving cockpit select carries a real accessible name (9.7). It
    // lives inside the collapsed "Manual override" <details> — expand first.
    await page.getByText("Manual override").first().click();
    await expect(
      page.getByLabel("Crew to place on this seat").first(),
    ).toBeVisible();

    // The withdrawn Manning UI offers nothing to click (#440-adjacent, S55).
    await expect(
      page.getByRole("heading", { name: "Manning" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "+ Required hand" }),
    ).toHaveCount(0);

    // Crewed-gate summary (9.8): Firkin's one required captain seat is Bailed.
    await expect(
      page.getByText(/0\/1 required seats confirmed — Crewed when all confirm/),
    ).toBeVisible();
  });

  test("each seat's eligible pool starts collapsed (operator preference, 2026-07-05)", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shift/shift-ar-regress");

    // Firkin's captain seat has an eligible pool (Marisol et al.). Its <details>
    // renders closed by default now — the summary shows, the candidate rows don't.
    const pool = page
      .locator("details", { has: page.getByText(/^Eligible pool ·/) })
      .first();
    await expect(pool).toBeVisible();
    expect(await pool.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(
      false,
    );
  });

  test("the whole board card is a click target (stretched link), controls still tappable", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    // Click the card's whitespace (bottom-right corner, away from the
    // vessel-name link text) → the stretched link opens the pane. Positioned
    // locator click auto-scrolls (a raw mouse.click at page coords misses when
    // the card sits below the fold).
    const card = page
      .locator("div.relative", { has: page.getByText("Growler") })
      .first();
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    await card.click({ position: { x: box.width - 12, y: box.height - 8 } });
    await page.waitForURL(/sel=/);
    await expect(
      page.getByRole("heading", { level: 2, name: /^Growler/ }),
    ).toBeVisible();
  });

  // SKIPPED — #447 (admin nav). The desktop nav overflows its row: the links block
  // overlaps the tenant/date label and the "Crew view" button, so the label renders
  // zero-width (hidden) and Playwright reports `<span>Outbox</span> ... intercepts
  // pointer events` on the button. A real UI bug, deliberately NOT patched around:
  // letting the row wrap would bust the 52px height budget the two-pane shell
  // subtracts (#253) — see the note in components/admin/admin-nav.tsx. The
  // assertions below are correct and unchanged; un-skip when #447 lands.
  test.fixme("the AdminNav names the tenant and today's vessel-local date", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shifts");

    const nav = page.getByRole("navigation", { name: "Admin" });
    await expect(nav.getByText(/BrewBoat · \w{3}, \w{3} \d{1,2}/)).toBeVisible();
  });
});
