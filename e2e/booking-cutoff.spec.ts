/**
 * The booking cutoff (16.3, issue #1071, DEC-193) — `/book`, the checkout, and the operator's
 * calendar, each inside the cutoff.
 *
 * Uses the `reservation` seed: one live offering on three boats, departures 13:30 / 15:30 / 17:30
 * every day from today. Every test works on **tomorrow** (vessel-local), which has no bookings and
 * always has all three departures ahead of it whatever time the suite runs. The cutoff is set in
 * hours computed from now, so the boundary lands between two departures rather than on one:
 *
 * - **all of tomorrow**: enough hours to cover tomorrow's 17:30. The day after's 13:30 is twenty
 *   hours later, so rounding up cannot reach it.
 * - **mixed**: enough to cover tomorrow's 15:30 but not its 17:30, two hours later.
 *
 * `resetAndSeed` wipes `app_settings`, so each test starts with no cutoff.
 */
import type { Page } from "@playwright/test";
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";
import { DEMO, TODAY, formatShortDay } from "./reservation-demo.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { TEST_DATABASE_URL } from "../db/reset-test.js";
import { zonedWallClockToInstant } from "../src/config/tenant.js";

const DEMO_OFFERING = "offering-reservation-demo";

const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const TOMORROW = addDays(TODAY, 1);
const DAY_AFTER = addDays(TODAY, 2);
const [EARLY, MIDDLE, LATE] = DEMO.departureTimes as [string, string, string]; // 13:30, 15:30, 17:30

/** Whole hours from now that reach tomorrow's departure at `time`. */
function hoursToCover(time: string): number {
  return Math.ceil((zonedWallClockToInstant(TOMORROW, time).getTime() - Date.now()) / 3_600_000);
}

async function setCutoff(hours: number): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    await repo.setBookingCutoffHours(hours, new Date().toISOString());
  } finally {
    await repo.close();
  }
}

const slot = (page: Page, time: string) => page.getByTestId(`slot-${time}`);

test.describe("the booking cutoff (DEC-193)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("/book: a day wholly inside the cutoff says to call, and sells nothing", async ({ page }) => {
    await setCutoff(hoursToCover(LATE));
    await page.goto(`/book?date=${TOMORROW}`);

    await expect(
      page.getByText(`Too late to book ${formatShortDay(TOMORROW)} online. Call us and we’ll book it for you.`, {
        exact: true,
      }),
    ).toBeVisible();
    for (const time of [EARLY, MIDDLE, LATE]) {
      await expect(slot(page, time)).toContainText("Call to book");
      // Not a link: there is nothing to pick.
      expect(await slot(page, time).evaluate((el) => el.tagName)).toBe("DIV");
    }
    // Three rows and the legend's key.
    await expect(page.getByText("Call to book", { exact: true })).toHaveCount(4);
    await expect(page.getByTestId("continue")).toHaveCount(0);
    await expect(page.getByText("Pick a date & time to continue")).toBeVisible();
  });

  test("/book: the month marks the day amber, and it opens", async ({ page }) => {
    await setCutoff(hoursToCover(LATE));
    // Show tomorrow's month WITHOUT selecting tomorrow, so its cell draws in its own state.
    const sameMonth = TOMORROW.slice(0, 7) === DAY_AFTER.slice(0, 7);
    await page.goto(sameMonth ? `/book?date=${DAY_AFTER}` : "/book");

    const cell = page.locator(`a[data-day-state="phone"][href*="date=${TOMORROW}"]`);
    await expect(cell).toBeVisible();
    await expect(page.getByText("Call to book", { exact: true })).toHaveCount(1); // the legend
    await cell.click();
    await expect(page).toHaveURL(new RegExp(`date=${TOMORROW}`));
    await expect(slot(page, EARLY)).toContainText("Call to book");
  });

  test("/book: a mixed day sells the late trip and sends the early ones to the phone", async ({ page }) => {
    await setCutoff(hoursToCover(MIDDLE));
    await page.goto(`/book?date=${TOMORROW}`);

    await expect(slot(page, EARLY)).toContainText("Call to book");
    await expect(slot(page, MIDDLE)).toContainText("Call to book");
    await expect(slot(page, LATE)).toContainText("3 boats open");
    // No notice and no legend key: the rows say which is which.
    await expect(page.getByText("Too late to book")).toHaveCount(0);
    await expect(page.getByText("Call to book", { exact: true })).toHaveCount(2);
    // The late trip is auto-selected and Continue carries it.
    const href = await page.getByTestId("continue").getAttribute("href");
    expect(href).toContain(`time=${encodeURIComponent(LATE)}`);
  });

  test("/book/checkout: a departure inside the cutoff is refused before the form", async ({ page }) => {
    await setCutoff(hoursToCover(LATE));
    await page.goto(`/book/checkout?offering=${DEMO_OFFERING}&date=${TOMORROW}&time=${EARLY}&guests=12`);

    await expect(page.getByRole("heading", { name: "Too late to book online", level: 1 })).toBeVisible();
    // The whole sentence, date and time included — a substring would pass with a lost space.
    await expect(
      page.getByText(
        `${formatShortDay(TOMORROW)} · 1:30 PM is too close to departure to book online. Call us and we’ll book it for you. Nothing was charged.`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Pick another time" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Book & pay/ })).toHaveCount(0);
  });

  test("with no cutoff set, tomorrow sells as it always has", async ({ page }) => {
    await page.goto(`/book?date=${TOMORROW}`);
    await expect(slot(page, EARLY)).toContainText("3 boats open");
    await expect(page.getByText("Call to book", { exact: true })).toHaveCount(0);
  });

  test("operator calendar: drawn open, marked phone only, counted open, still bookable", async ({ page }) => {
    await setCutoff(hoursToCover(LATE));
    await signInAsAdmin(page, "eric");
    await page.goto(`/admin/calendar?date=${TOMORROW}`);

    const open = page.locator('[data-testid="cal-block"][data-status="available"]');
    await expect(open).toHaveCount(DEMO.fleet.length * DEMO.departureTimes.length);
    await expect(open.filter({ hasText: "phone only" })).toHaveCount(DEMO.fleet.length * DEMO.departureTimes.length);

    await page.goto(`/admin/calendar?date=${TOMORROW}&view=list`);
    const row = page.locator(`[data-testid="cal-row"][data-vessel="${DEMO.vesselId}"][data-time="${EARLY}"]`);
    await expect(row).toHaveAttribute("data-status", "open");
    await expect(row).toContainText("Open · phone only");
    await expect(row.getByRole("link", { name: "+ Book" })).toBeVisible();

    // Counted open: the Open chip keeps every one of them.
    await page.getByTestId("filter-open").click();
    await expect(page.getByTestId("cal-row")).toHaveCount(DEMO.fleet.length * DEMO.departureTimes.length);
  });
});
