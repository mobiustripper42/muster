/**
 * Customer checkout screen (task 12.5, #458, DEC-134) — drives the public `/book/checkout`
 * inline-Elements form.
 *
 * Uses the `reservation` seed (see book-availability.spec.ts): LIVE offering
 * "Reservation Demo Cruise" on Brew 3 (cap 12, included = cap), base $499, $50/extra guest,
 * owned Aug 10–16 2026, departures 13:30/15:30/17:30, Aug 12 13:30 booked (Marcus Webb).
 * Payment config rides the defaults: deposit 25%, tax 7.25%, service fee 3% (DEC-134),
 * tip tiers 15/20/25 with 20% preselected (DEC-124).
 *
 * Money pins for 2 guests at 15:30 (fare $499.00, no extras):
 *   tax $36.18 · fee $14.97 · tip20 $99.80 → total $649.95, due now $275.70 (deposit $124.75
 *   + full tax + full fee + full tip) · tip15 $74.85 → total $625.00, due now $250.75.
 *
 * The e2e deliberately stops SHORT of `stripe.confirmPayment` — there is no Stripe network
 * here (the publishable key is a dummy), so it asserts form states, totals, and gates. The
 * actual paid booking (test card 4242… → webhook → reservation) is the manual exit gate.
 *
 * Runs desktop + 375px (registered in the mobile testMatch).
 */
import {
  test,
  expect,
  resetAndSeed,
  clickHydrated,
  setCheckedHydrated,
} from "./fixtures.js";

const CHECKOUT =
  "/book/checkout?offering=offering-reservation-demo&date=2026-08-12&time=15:30&guests=2";

test.describe("public /book/checkout", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("renders the trip, the full money summary, and the sticky pay bar", async ({ page }) => {
    await page.goto(CHECKOUT);

    // Hero + trip block reflect the picked slot.
    await expect(page.getByRole("heading", { name: "Reservation Demo Cruise", level: 1 })).toBeVisible();
    await expect(page.getByText("Wed, Aug 12 · 3:30 PM")).toBeVisible();
    await expect(page.getByText("· 2 guests")).toBeVisible();

    // Summary: fare · tip → crew · tax · fee · total (DEC-134 line items, honest about
    // where money goes — the tip is exempt from tax + fee and the rows reflect that).
    await expect(page.getByText("Fare — up to 12 guests")).toBeVisible();
    await expect(page.getByTestId("summary-tip")).toContainText("$99.80");
    await expect(page.getByText("Tax · 7.25%")).toBeVisible();
    await expect(page.getByTestId("summary-fee")).toContainText("$14.97");
    await expect(page.getByTestId("summary-fee")).toContainText("3%");
    await expect(page.getByTestId("summary-total")).toContainText("$649.95");

    // Deposit mode: due-now = deposit share + FULL tax + FULL fee + FULL tip; balance is
    // the remaining fare only (no second fee — the DEC-134 pin, visible to the customer).
    await expect(page.getByTestId("summary-due-now")).toContainText("$275.70");
    await expect(page.getByText("Balance · charged before your trip")).toBeVisible();
    await expect(page.getByTestId("due-now")).toHaveText("$275.70");

    // The inert future gift-card row renders disabled, not clickable-looking.
    await expect(page.getByText("Apply gift card or discount code")).toBeVisible();
  });

  test("changing the tip tile re-totals live (client island, no navigation)", async ({ page }) => {
    await page.goto(CHECKOUT);

    // 20% is preselected (DEC-124).
    await expect(page.getByTestId("tip-2000")).toHaveAttribute("aria-pressed", "true");

    await clickHydrated(page.getByTestId("tip-1500"));
    await expect(page.getByTestId("tip-1500")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("due-now")).toHaveText("$250.75");
    await expect(page.getByTestId("summary-total")).toContainText("$625.00");
    await expect(page.getByTestId("summary-tip")).toContainText("$74.85");

    await page.getByTestId("tip-2500").click();
    await expect(page.getByTestId("due-now")).toHaveText("$300.65");
    await expect(page).toHaveURL(/time=15/); // same server render — the island did the math
  });

  test("the waiver gate blocks Book & pay until agreed", async ({ page }) => {
    await page.goto(CHECKOUT);

    const pay = page.getByTestId("book-pay");
    await expect(pay).toBeVisible();
    await expect(pay).toBeDisabled(); // no waiver, no submit (DEC-110)

    await setCheckedHydrated(page.getByTestId("waiver"), true);
    await expect(pay).toBeEnabled();

    await setCheckedHydrated(page.getByTestId("waiver"), false);
    await expect(pay).toBeDisabled();
  });

  test("a stale link to a sold-out slot gets an honest notice, not a doomed form", async ({ page }) => {
    // Aug 12 13:30 is the seeded Marcus Webb booking — sold out before this link was opened.
    await page.goto(
      "/book/checkout?offering=offering-reservation-demo&date=2026-08-12&time=13:30&guests=2",
    );
    await expect(
      page.getByRole("heading", { name: "That departure is no longer available" }),
    ).toBeVisible();
    await expect(page.getByText("Nothing was charged.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Pick another time" })).toBeVisible();
    await expect(page.getByTestId("book-pay")).toHaveCount(0); // no form rendered
  });

  test("a guest count over the boat's cap is refused up front", async ({ page }) => {
    await page.goto(
      "/book/checkout?offering=offering-reservation-demo&date=2026-08-12&time=15:30&guests=99",
    );
    await expect(
      page.getByRole("heading", { name: "That departure is no longer available" }),
    ).toBeVisible();
  });

  test("the availability screen's Continue link lands here with the same slot + guests", async ({ page }) => {
    await page.goto("/book?date=2026-08-12");
    await page.getByTestId("continue").click();

    await expect(page).toHaveURL(/\/book\/checkout\?offering=offering-reservation-demo/);
    await expect(page).toHaveURL(/date=2026-08-12/);
    await expect(page).toHaveURL(/guests=2/);
    await expect(page.getByRole("heading", { name: "Reservation Demo Cruise", level: 1 })).toBeVisible();
    await expect(page.getByTestId("due-now")).toBeVisible();
  });

  test("no horizontal overflow (375px layout holds)", async ({ page }) => {
    await page.goto(CHECKOUT);
    await expect(page.getByTestId("book-pay")).toBeVisible();
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(fits).toBe(true);
  });
});
