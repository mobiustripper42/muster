/**
 * Customers — the contact list + detail (task 12.12b, #465, DEC-132).
 *
 * The `reservation` seed books three trips on Brew 3 with phones, two of them by Marcus Webb
 * with the SAME number written two different ways ("216-555-0148" and "+1 216 555 0148"). So the
 * seed itself proves the load-bearing property: canonicalization collapses them to ONE customer
 * with two bookings, while Dana Cho stays separate.
 *
 * Lifetime = fare + extra guests on booked trips, gratuity EXCLUDED (DEC-124). Marcus:
 * $549.00 + $549.00 = $1,098.00 (the seed freezes no extras). Dana: $439.00.
 *
 * Runs desktop + 375px.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";
import { BOOKED, BOOKED_3, monthDay } from "./reservation-demo.js";

test.describe("admin /admin/customers", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("lists customers with bookings + lifetime; the same phone is ONE customer", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/customers");

    // Two customers from three bookings — Marcus's two spellings canonicalized together.
    const marcus = page.getByRole("row").filter({ hasText: "Marcus Webb" });
    const dana = page.getByRole("row").filter({ hasText: "Dana Cho" });
    await expect(marcus).toHaveCount(1);
    await expect(dana).toHaveCount(1);

    // Marcus: 2 bookings, $1,098.00 lifetime. Dana: 1 booking, $439.00.
    await expect(marcus).toContainText("2");
    await expect(marcus).toContainText("$1,098.00");
    await expect(dana).toContainText("$439.00");

    // Phones render in the operator's format, not raw E.164.
    await expect(marcus).toContainText("(216) 555-0148");

    // The lifetime caveat is stated on the page — the number is not "money collected".
    await expect(page.getByText(/Tips go to crew and are never counted as revenue/)).toBeVisible();
  });

  test("search matches name, phone punctuation, and display code", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/customers");

    // Grab Marcus's minted display code off the row — it's random per seed run.
    const marcusRow = page.getByRole("row").filter({ hasText: "Marcus Webb" });
    const code = (await marcusRow.locator("div.font-mono").first().textContent())?.trim() ?? "";
    expect(code).toMatch(/^C-[0-9A-Z]{6}$/);

    // By name.
    await page.getByLabel("Search customers").fill("Cho");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("row").filter({ hasText: "Dana Cho" })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Marcus Webb" })).toHaveCount(0);

    // By phone, punctuated differently than stored.
    await page.goto("/admin/customers?q=(216)+555-0148");
    await expect(page.getByRole("row").filter({ hasText: "Marcus Webb" })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Dana Cho" })).toHaveCount(0);

    // By display code.
    await page.goto(`/admin/customers?q=${encodeURIComponent(code)}`);
    await expect(page.getByRole("row").filter({ hasText: "Marcus Webb" })).toHaveCount(1);

    // A miss says so rather than showing an empty table.
    await page.goto("/admin/customers?q=nobody");
    await expect(page.getByText(/No customer matches/)).toBeVisible();
  });

  test("detail shows the contact + booking history, newest first", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/customers");
    await page.getByRole("link", { name: "Marcus Webb" }).click();
    await page.waitForURL(/\/admin\/customers\/cust-/);

    await expect(page.getByRole("heading", { name: "Marcus Webb", level: 1 })).toBeVisible();
    await expect(page.getByText("(216) 555-0148")).toBeVisible();
    await expect(page.getByText(/2 bookings · \$1,098\.00 lifetime/)).toBeVisible();

    // History newest departure first: the 16th before the 12th.
    const rows = page.getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(monthDay(BOOKED_3.date));
    await expect(rows.last()).toContainText(monthDay(BOOKED.date));
    await expect(rows.first()).toContainText("10 guests");

    // Read-only slice — no edit/message actions ship yet.
    await expect(page.getByRole("button", { name: /message/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /edit/i })).toHaveCount(0);
  });

  test("a history row opens that booking's detail on the calendar", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/customers");
    await page.getByRole("link", { name: "Dana Cho" }).click();
    await page.getByRole("link", { name: "Open" }).first().click();

    await page.waitForURL(/\/admin\/calendar\/resv-demo/);
    await expect(page.getByTestId("reservation-detail")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dana Cho", level: 1 })).toBeVisible();
  });

  test("an unknown customer 404s", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    const res = await page.goto("/admin/customers/cust-does-not-exist");
    expect(res?.status()).toBe(404);
  });
});
