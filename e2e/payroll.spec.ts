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

    // shift-soon: two trips (15:00 + 17:00) → (120) + trip 100 + 2×lead 90 = 310 min
    // = 5h 10m, for both confirmed required crew (Quint captain, Hooper mate).
    await expect(page.getByText("Quint")).toBeVisible();
    await expect(page.getByText("Hooper")).toBeVisible();
    await expect(page.getByText("5h 10m").first()).toBeVisible();
  });
});
