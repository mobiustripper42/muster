/**
 * Insurance is not sold inside the 72 hours it buys (16.8, DEC-197) — the box is absent on the
 * customer's checkout and the operator's phone booking for a departure that close, and present for
 * one further out.
 *
 * Uses the `reservation` seed, like `booking-cutoff.spec.ts`: departures 13:30 / 15:30 / 17:30 every
 * day from today. **Tomorrow** (vessel-local) is always inside 72 hours, whatever time the suite
 * runs, and has no bookings. **Five days out** is always outside, by more than a day.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";
import { DEMO, TODAY } from "./reservation-demo.js";

const DEMO_OFFERING = "offering-reservation-demo";

const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const TOMORROW = addDays(TODAY, 1);
const FIVE_OUT = addDays(TODAY, 5);
const [EARLY] = DEMO.departureTimes as [string];

const checkout = (date: string) =>
  `/book/checkout?offering=${DEMO_OFFERING}&date=${date}&time=${EARLY}&guests=2`;
const phoneBooking = (date: string) =>
  `/admin/calendar?date=${date}&hold=${encodeURIComponent(`${DEMO.vesselId}|${EARLY}`)}&book=1&guests=2`;

test.describe("insurance is not sold inside 72 hours (DEC-197)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("/book/checkout: no box tomorrow, the box five days out", async ({ page }) => {
    await page.goto(checkout(TOMORROW));
    // The tip tiles render beside the box, so their presence proves the form is there to look at.
    await expect(page.getByTestId("tip-2000")).toBeVisible();
    await expect(page.getByTestId("add-insurance")).toHaveCount(0);
    await expect(page.getByTestId("cancellation-terms")).not.toContainText("insurance");

    await page.goto(checkout(FIVE_OUT));
    await expect(page.getByTestId("add-insurance")).toBeVisible();
  });

  test("phone booking: no box tomorrow, the box five days out", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(phoneBooking(TOMORROW));
    await expect(page.getByTestId("tip-2000")).toBeVisible();
    await expect(page.getByTestId("add-insurance")).toHaveCount(0);

    await page.goto(phoneBooking(FIVE_OUT));
    await expect(page.getByTestId("add-insurance")).toBeVisible();
  });
});
