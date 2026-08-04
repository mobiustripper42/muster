/**
 * Payroll hours (#347): the pay-period dropdown + per-crew estimated hours. The
 * date math + hours computation are unit-tested (src/admin/pay-periods.test.ts,
 * payroll.test.ts); here we drive the SURFACE — the period picker filters, and an
 * assigned crew member's committed hours render. Runs desktop + 375px.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("admin /admin/payroll — estimated hours by pay period", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("picks the period containing a confirmed shift and shows its committed hours", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/payroll");
    await expect(page.getByRole("heading", { name: "Payroll hours" })).toBeVisible();

    // `shift-soon` (crew seed) is 15 days out — a later period than the default
    // (current) one. Compute its date the same way the seed does (en-CA / vessel
    // zone), then pick the pay-period option whose range contains it.
    const soon = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(Date.now() + 15 * 24 * 3600 * 1000));
    const select = page.locator("#period");
    const values = await select
      .locator("option")
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    const target = values.find((v) => {
      const [s, e] = v.split("|");
      return s! <= soon && soon <= e!;
    });
    expect(target).toBeTruthy();
    await select.selectOption(target!);
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.waitForURL(/period=/);

    // shift-soon: two trips (15:00 + 17:00) → span 120 + trip 100 + call lead 45 +
    // teardown 25 = 290 min = 4h 50m (#275), for both confirmed required crew
    // (Quint captain, Hooper mate).
    // Scoped to the table: with TIME_CLOCK on, the page also carries a warnings list that can
    // name the same person, so a bare getByText is ambiguous (#628).
    await expect(page.getByRole("cell", { name: "Quint", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Hooper", exact: true })).toBeVisible();
    await expect(page.getByText("4h 50m").first()).toBeVisible();
  });
});
