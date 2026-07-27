/**
 * Purchases — the order list (task 12.12a, #465).
 *
 * The `reservation` seed books three Muster trips on Brew 3 with NO payments recorded, so every
 * row is `unpaid` — which is exactly the state the mockup never drew and the one this list must
 * not mislabel as "deposit" (that would report money that never arrived).
 *
 * Runs desktop + 375px.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("admin /admin/purchases", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("lists Muster orders with derived state; nothing paid reads UNPAID", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/purchases");

    // Three seeded bookings, newest departure first (Aug 16 → Aug 13 → Aug 12).
    const rows = page.getByRole("row");
    await expect(page.getByRole("link", { name: "Marcus Webb" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Dana Cho" })).toHaveCount(1);

    // No payments seeded ⇒ every order is UNPAID, never "deposit". Scoped to the row badges:
    // the filter chips carry the same words, so a page-wide text match would count those too.
    const badges = page.locator('[data-testid^="row-state-"]');
    await expect(badges).toHaveCount(3);
    for (const text of await badges.allTextContents()) expect(text.trim()).toBe("unpaid");

    // Total is fare + tax (43900 + 3183 = 47083). No "due" line on an UNPAID order: the
    // balance equals the total there and the badge already says it, so repeating it is noise.
    const dana = rows.filter({ hasText: "Dana Cho" });
    await expect(dana).toContainText("$470.83");
    await expect(dana).not.toContainText("due");

    // Phones render in ONE format, not however each customer happened to type it — the seed
    // stores "216-555-0148", "+1 216 555 0148" and "(440) 555-0102".
    await expect(dana).toContainText("(440) 555-0102");
    await expect(rows.filter({ hasText: "Marcus Webb" }).first()).toContainText("(216) 555-0148");

    // The caveat is stated — the total isn't "money collected", and tips aren't in it.
    await expect(page.getByText(/Tips aren’t included/)).toBeVisible();
  });

  test("filter chips carry counts and narrow the list", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/purchases");

    await expect(page.getByTestId("state-all")).toContainText("3");
    await expect(page.getByTestId("state-unpaid")).toContainText("3");
    await expect(page.getByTestId("state-paid")).toContainText("0");

    // A filter with no members says so rather than rendering an empty table.
    await page.getByTestId("state-paid").click();
    await page.waitForURL(/state=paid/);
    await expect(page.getByText(/No order matches/)).toBeVisible();

    // Back to All restores the three.
    await page.getByTestId("state-all").click();
    await expect(page.getByRole("link", { name: "Dana Cho" })).toHaveCount(1);
  });

  test("search finds an order by name and by punctuated phone, and survives a filter", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");

    await page.goto("/admin/purchases?q=Cho");
    await expect(page.getByRole("link", { name: "Dana Cho" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Marcus Webb" })).toHaveCount(0);

    // Marcus's seeded phone is "216-555-0148"; punctuation shouldn't matter.
    await page.goto("/admin/purchases?q=(216)+555-0148");
    await expect(page.getByRole("link", { name: "Marcus Webb" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Dana Cho" })).toHaveCount(0);

    // Search + state compose (both seeded orders are unpaid).
    await page.goto("/admin/purchases?q=Cho&state=unpaid");
    await expect(page.getByRole("link", { name: "Dana Cho" })).toHaveCount(1);
  });

  test("a row opens the calendar's detail pane — no second detail surface", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/purchases?q=Cho");
    await page.getByRole("link", { name: "Dana Cho" }).click();

    await page.waitForURL(/\/admin\/calendar\/resv-demo/);
    await expect(page.getByTestId("reservation-detail")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dana Cho", level: 1 })).toBeVisible();
  });
});
