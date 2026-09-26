/**
 * The operator books by phone (16.1d, issue #1092) — calendar click → passengers → the checkout's
 * own summary and form, in operator mode.
 *
 * The point of 16.1d is that this is not a second form. So the money is not pinned with literals
 * here: the first test reads the figure off PUBLIC checkout for the same trip, party and tip, and
 * requires the operator's screen to show the same one. A drift between the two surfaces fails here
 * whichever of them moved.
 *
 * `reservation` seed: the demo offering on Brew 3 (cap 12, the smallest boat), 15:30 open on the
 * booked day. Brew 3 is the boat public checkout would put a party of 2 on, which is what makes the
 * two totals comparable at all.
 *
 * Runs desktop + 375px (registered in the mobile testMatch).
 */
import type { Page } from "@playwright/test";
import { test, expect, clickHydrated, fillHydrated, resetAndSeed, signInAsAdmin } from "./fixtures.js";
import { shortTime } from "../src/reservations/calendar-grid.js";
import { BOOKED, DEMO, OPEN_TIME } from "./reservation-demo.js";

const openAt = (page: Page, time: string) =>
  page.locator(`[data-testid="cal-block"][data-vessel="${DEMO.vesselId}"]`).filter({ hasText: `open · ${time}` });

const BOOK = `/admin/calendar/book?date=${BOOKED.date}&vessel=${DEMO.vesselId}&time=${OPEN_TIME}`;
const PUBLIC = `/book/checkout?offering=offering-reservation-demo&date=${BOOKED.date}&time=${OPEN_TIME}&guests=2`;

test.describe("admin phone booking", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("calendar → passengers → the checkout's figures → booked, awaiting payment", async ({ page }) => {
    // What a customer booking this trip for 2 is shown, read off the public screen.
    await page.goto(PUBLIC);
    const publicTotal = (await page.getByTestId("summary-total").textContent())!.replace("Total", "").trim();
    await clickHydrated(page.getByTestId("tip-1500"));
    const publicAt15 = (await page.getByTestId("due-now").textContent())!.trim();

    await signInAsAdmin(page, "eric");
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);
    await openAt(page, shortTime(OPEN_TIME)).click();
    await page.getByTestId("hold-confirm").getByTestId("book-slot").click();

    // Passengers first — the money depends on it.
    await expect(page.getByRole("heading", { name: new RegExp(`^${shortTime(OPEN_TIME)} PM on Brew 3$`) })).toBeVisible();
    await page.getByLabel("Guests").fill("2");
    await page.getByRole("button", { name: "Continue" }).click();

    // The checkout's own summary, same figures as public.
    await expect(page.getByTestId("summary-total")).toContainText(publicTotal);
    await expect(page.getByTestId("tip-2000")).toHaveAttribute("aria-pressed", "true");
    // Tip tiles re-total live, as at /book/checkout.
    await clickHydrated(page.getByTestId("tip-1500"));
    await expect(page.getByTestId("due-now")).toHaveText(publicAt15);
    // Nothing the phone order does not collect.
    await expect(page.getByTestId("waiver")).toHaveCount(0);
    await expect(page.getByTestId("stripe-loading")).toHaveCount(0);

    // Change goes back to passengers with the count kept.
    await page.getByRole("link", { name: "Change" }).click();
    await expect(page.getByLabel("Guests")).toHaveValue("2");
    await page.getByRole("button", { name: "Continue" }).click();

    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Phone Caller");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0199");
    await page.getByTestId("book-phone").click();

    await page.waitForURL(/\/admin\/calendar\/resv-/);
    await expect(page.getByTestId("phone-booking-state")).toHaveText(/Awaiting payment/);
  });

  test("a refused booking comes back on the form with what was typed", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=2`);
    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Kept Name");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "123");
    await page.getByTestId("book-phone").click();

    await expect(page.getByText("That mobile number doesn’t look right")).toBeVisible();
    await expect(page.getByPlaceholder("Guest’s full name")).toHaveValue("Kept Name");
    // Still the checkout step, for the same party.
    await expect(page.getByTestId("summary-total")).toBeVisible();
    await expect(page).toHaveURL(/guests=2/);
  });

  test("the banner closes with ✕ and writes nothing", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);
    await openAt(page, shortTime(OPEN_TIME)).click();
    const banner = page.getByTestId("hold-confirm");
    await expect(banner).toBeVisible();
    await banner.getByRole("link", { name: "Close" }).click();
    await expect(page.getByTestId("hold-confirm")).toHaveCount(0);
    await expect(openAt(page, shortTime(OPEN_TIME))).toBeVisible();
  });

  test("more guests than the boat takes is refused on the passengers step", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=13`);
    await expect(page.getByText("Brew 3 takes 12")).toBeVisible();
    await expect(page.getByTestId("summary-total")).toHaveCount(0);
  });

  test("no horizontal overflow (375px layout holds)", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=2`);
    await expect(page.getByTestId("book-phone")).toBeVisible();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(fits).toBe(true);
  });
});
