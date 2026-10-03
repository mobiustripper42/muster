/**
 * The calendar's List view, to sell from (16.1b, issue #1079): one row per departure (a boat at a
 * time) for the day on screen, each opening the same pane its grid card opens, with **+ Book** on
 * the open rows going straight to the booking steps. Same page, loader, chips and panes as the grid
 * — the list is a second way to draw the same day, not a second way to sell.
 *
 * `reservation` seed: the demo cruise on three boats (Brew 3 cap 12, Brew 1 cap 14, Brew 2 cap 16)
 * at 13:30 / 15:30 / 17:30. On the booked day Marcus Webb (party 8) has Brew 3 at 13:30 and every
 * other departure is open. Read dates from `BOOKED`, never from this comment.
 *
 * Runs desktop + 375px (registered in the mobile testMatch).
 */
import type { Page } from "@playwright/test";
import { test, expect, fillHydrated, plantShiftForBooking, resetAndSeed, signInAsAdmin } from "./fixtures.js";
import { shortTime } from "../src/reservations/calendar-grid.js";
import { BOOKED, DEMO, OPEN_TIME, demoReservationId } from "./reservation-demo.js";

const LIST = `/admin/calendar?date=${BOOKED.date}&view=list`;

/** The row for one departure: a boat at a time. */
const rowAt = (page: Page, vesselId: string, time: string) =>
  page.locator(`[data-testid="cal-row"][data-vessel="${vesselId}"][data-time="${time}"]`);

test.describe("admin calendar — List view (issue #1079)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("Grid | List switches the view; one row per departure, in the operator's words", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);
    await page.getByTestId("view-list").click();
    await expect(page).toHaveURL(/view=list/);
    await expect(page.getByTestId("view-list")).toHaveAttribute("aria-current", "page");

    // Every departure of the day, booked or open: three boats × three times.
    const rows = page.getByTestId("cal-row");
    await expect(rows).toHaveCount(DEMO.fleet.length * DEMO.departureTimes.length);

    const marcus = rowAt(page, DEMO.vesselId, BOOKED.time);
    await expect(marcus).toHaveAttribute("data-status", "booked");
    await expect(marcus).toContainText("Booked");
    await expect(marcus).toContainText("Marcus Webb · 8 guests");
    await expect(marcus.getByRole("link", { name: "+ Book" })).toHaveCount(0);

    const open = rowAt(page, DEMO.vesselId, OPEN_TIME);
    await expect(open).toHaveAttribute("data-status", "open");
    await expect(open).toContainText("Open");
    await expect(open).toContainText("Takes 12 guests");
    await expect(open).toContainText("Reservation Demo Cruise");
    await expect(open.getByRole("link", { name: "+ Book" })).toBeVisible();

    // Back to the grid.
    await page.getByTestId("view-grid").click();
    await expect(page.getByTestId("cal-row")).toHaveCount(0);
    await expect(page.locator('[data-testid="cal-block"]').first()).toBeVisible();
  });

  test("Crew: a booked row shows seats filled out of seats needed, read from its shift", async ({ page }) => {
    await plantShiftForBooking({ reservationId: demoReservationId(BOOKED.date, BOOKED.time), required: 2 });
    await signInAsAdmin(page, "eric");
    await page.goto(LIST);

    const marcus = rowAt(page, DEMO.vesselId, BOOKED.time);
    // Nobody on either seat yet: 0 of 2, which reads as short.
    await expect(marcus).toContainText("0/2");
    // An open row has no shift and so no crew figure.
    await expect(rowAt(page, DEMO.vesselId, OPEN_TIME)).not.toContainText("/2");
  });

  test("the chips and the day arrows keep the List", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(LIST);

    await page.getByTestId("filter-booked").click();
    await expect(page).toHaveURL(/view=list/);
    await expect(page.getByTestId("cal-row")).toHaveCount(1);
    await page.getByTestId("filter-open").click();
    await expect(page.getByTestId("cal-row")).toHaveCount(DEMO.fleet.length * DEMO.departureTimes.length - 1);
    await page.getByTestId("filter-all").click();

    await page.getByRole("link", { name: "Next day" }).click();
    await expect(page).not.toHaveURL(new RegExp(`date=${BOOKED.date}`));
    await expect(page).toHaveURL(/view=list/);
    await expect(page.getByTestId("cal-row").first()).toBeVisible();
  });

  test("a booked row opens its booking pane; Close goes back to the List", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(LIST);

    await rowAt(page, DEMO.vesselId, BOOKED.time).getByRole("link", { name: /Marcus Webb/ }).click();
    await page.waitForURL(/\/admin\/calendar\/resv-.*view=list/);
    const pane = page.getByTestId("reservation-detail");
    await expect(pane.getByRole("heading", { name: "Marcus Webb", level: 2 })).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      // The row stays on screen beside the pane, marked as the one open.
      await expect(rowAt(page, DEMO.vesselId, BOOKED.time)).toHaveAttribute("data-cal-selected", "");
    }

    const out = (page.viewportSize()?.width ?? 0) >= 1024 ? "Close" : "Back to calendar";
    await page.getByRole("link", { name: out }).click();
    await expect(page).toHaveURL(/\/admin\/calendar\?.*view=list/);
    await expect(page.getByTestId("cal-row").first()).toBeVisible();
  });

  test("+ Book on an open row goes straight to the booking steps for that boat and time", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(LIST);

    await rowAt(page, DEMO.vesselId, OPEN_TIME).getByRole("link", { name: "+ Book" }).click();
    const bookPane = page.getByTestId("book-pane");
    await expect(bookPane.getByRole("heading", { name: `${shortTime(OPEN_TIME)} PM · Brew 3`, level: 2 })).toBeVisible();
    await expect(page).toHaveURL(/book=1/);
    await expect(page).toHaveURL(/view=list/);
  });

  test("an unpaid phone booking reads Unpaid, with who and what they owe", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(
      `/admin/calendar?date=${BOOKED.date}&hold=${encodeURIComponent(`${DEMO.vesselId}|${OPEN_TIME}`)}&book=1&guests=2`,
    );
    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Phone Caller");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0199");
    await page.getByTestId("book-phone").click();
    await page.waitForURL(/\/admin\/calendar\/resv-/);
    const owes = (await page.getByTestId("money-owes").textContent())!.trim();

    await page.goto(LIST);
    const row = rowAt(page, DEMO.vesselId, OPEN_TIME);
    await expect(row).toHaveAttribute("data-status", "unpaid");
    await expect(row).toContainText("Unpaid");
    await expect(row).toContainText("Phone Caller · 2 guests");
    await expect(row).toContainText(`owes ${owes}`);
  });

  test("no sideways scroll (375px layout holds)", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(LIST);
    await expect(page.getByTestId("cal-row").first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
