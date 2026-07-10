/**
 * #312 — the manual override picker is a sorted dropdown, not a wrapping row of
 * variable-width buttons. Asserts the control shape (a <select>), that its options
 * are alpha by first name, and that placing via it confirms the seat end-to-end.
 * The atrisk seed's `shift-ar-regress` has a captain seat with a real rated pool.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("cockpit manual override (#312)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("override is a first-name-sorted dropdown; placing via it confirms", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shift/shift-ar-regress");

    const override = page
      .locator("details", { has: page.getByText("Manual override") })
      .first();
    await override.locator("summary", { hasText: "Manual override" }).click();

    // The control is a <select> now (the #312 change), with the empty default
    // plus at least one rated crew option.
    const select = override.locator('select[name="crewMemberId"]');
    await expect(select).toBeVisible();
    const options = select.locator("option");
    expect(await options.count()).toBeGreaterThan(1);

    // Options after the "Select crew…" default are in first-name alpha order.
    const labels = (await options.allTextContents()).slice(1);
    const firsts = labels.map((l) => l.trim().split(/\s+/)[0] ?? l);
    expect(firsts).toEqual([...firsts].sort((a, b) => a.localeCompare(b)));

    // Placing a picked crew confirms them (no-JS: native select + form POST).
    const who = await options.nth(1).getAttribute("value");
    await select.selectOption(who!);
    await override.getByRole("button", { name: "Place" }).click();
    await expect(page.getByText(/placed by override — confirmed/i)).toBeVisible();
  });
});
