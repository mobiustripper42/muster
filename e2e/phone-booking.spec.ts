/**
 * The operator books by phone (16.1d, issue #1092) — calendar click → passengers → the checkout's
 * own summary and form, in operator mode. All of it inside the calendar's pane, with the grid still
 * beside it (issue #1104 part 3); there is no separate booking page.
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
import {
  test,
  expect,
  clickHydrated,
  fillHydrated,
  plantVesselBlock,
  resetAndSeed,
  signInAsAdmin,
} from "./fixtures.js";
import { shortTime } from "../src/reservations/calendar-grid.js";
import { BOOKED, DEMO, OPEN_TIME } from "./reservation-demo.js";

const openAt = (page: Page, time: string) =>
  page.locator(`[data-testid="cal-block"][data-vessel="${DEMO.vesselId}"]`).filter({ hasText: `open · ${time}` });

const BOOK = `/admin/calendar?date=${BOOKED.date}&hold=${encodeURIComponent(`${DEMO.vesselId}|${OPEN_TIME}`)}&book=1`;
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
    await page.getByTestId("slot-pane").getByTestId("book-slot").click();

    // Passengers first — the money depends on it. In the pane, on the calendar, with the grid still
    // beside it on desktop (issue #1104 part 3).
    await expect(page).toHaveURL(/\/admin\/calendar\?.*book=1/);
    const bookPane = page.getByTestId("book-pane");
    await expect(bookPane.getByRole("heading", { name: `${shortTime(OPEN_TIME)} PM · Brew 3`, level: 2 })).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) >= 1024) await expect(openAt(page, "5:30")).toBeVisible();
    await bookPane.getByLabel("Guests").fill("2");
    await page.getByRole("button", { name: "Continue" }).click();

    // The checkout's own summary, same figures as public — still in the pane.
    await expect(bookPane.getByTestId("summary-total")).toContainText(publicTotal);
    await expect(page.getByTestId("tip-2000")).toHaveAttribute("aria-pressed", "true");
    // Tip tiles re-total live, as at /book/checkout.
    await clickHydrated(page.getByTestId("tip-1500"));
    await expect(page.getByTestId("due-now")).toHaveText(publicAt15);
    // Nothing the phone order does not collect.
    // No terms box on the operator's side: the customer ticks it on the payment link (#1082, #1112).
    await expect(page.getByTestId("agree-terms")).toHaveCount(0);
    await expect(page.getByTestId("stripe-loading")).toHaveCount(0);

    // Change goes back to passengers with the count kept.
    await page.getByRole("link", { name: "Change" }).click();
    await expect(page.getByLabel("Guests")).toHaveValue("2");
    await page.getByRole("button", { name: "Continue" }).click();

    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Phone Caller");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0199");
    await page.getByTestId("book-phone").click();

    await page.waitForURL(/\/admin\/calendar\/resv-/);
    // The same pane as a paid booking (#1104 part 2): the customer's name, the state beside it,
    // and the frozen invoice with nothing paid — owing exactly what the operator read out. The trip
    // back through Change reset the tip to the default, so that is public's default total.
    const pane = page.getByTestId("reservation-detail");
    await expect(pane.getByRole("heading", { name: "Phone Caller", level: 2 })).toBeVisible();
    await expect(pane.getByTestId("booking-state")).toHaveText("Awaiting payment");
    await expect(pane).toContainText(`${shortTime(OPEN_TIME)} PM · Brew 3`);
    await expect(pane).toContainText("Booked by phone");
    await expect(pane.getByTestId("money-paid")).toHaveText("$0.00");
    await expect(pane.getByTestId("money-owes")).toHaveText(publicTotal);

    // On the grid it names the customer, like a booked card, and says it is unpaid (#1104).
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);
    const card = page.locator('[data-testid="cal-block"][data-status="awaiting-payment"]');
    await expect(card).toContainText("Phone Caller");
    await expect(card).toContainText(`${shortTime(OPEN_TIME)} · 2 · Unpaid`);
  });

  /**
   * Ending an unpaid phone booking from its pane. The abort comes first: Do Not Cancel must write
   * nothing, and the booking must still be awaiting payment afterwards.
   */
  test("cancel an unpaid booking: Do Not Cancel keeps it, Cancel this booking ends it", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=2`);
    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Phone Caller");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0199");
    await page.getByTestId("book-phone").click();
    await page.waitForURL(/\/admin\/calendar\/resv-/);
    const pane = page.getByTestId("reservation-detail");

    await pane.getByRole("link", { name: "Cancel booking…" }).click();
    await expect(pane).toContainText("Nothing was paid, so nothing is refunded.");
    await pane.getByRole("link", { name: "Do Not Cancel" }).click();
    await expect(pane.getByTestId("booking-state")).toHaveText("Awaiting payment");
    await expect(pane.getByRole("link", { name: "Cancel booking…" })).toBeVisible();

    await pane.getByRole("link", { name: "Cancel booking…" }).click();
    await pane.getByRole("button", { name: "Cancel this booking" }).click();
    await expect(pane.getByTestId("booking-state")).toHaveText("Cancelled");
    await expect(pane.getByTestId("money-owes")).toHaveText("Not owed — cancelled");
    await expect(pane).toContainText("Was quoted");
    await expect(pane.getByRole("link", { name: "Cancel booking…" })).toHaveCount(0);
  });

  test("Cancel on the passengers step goes back to the slot pane and books nothing", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(BOOK);
    await page.getByTestId("book-pane").getByRole("link", { name: "Cancel" }).click();
    await expect(page.getByTestId("slot-pane").getByTestId("book-slot")).toBeVisible();
    await expect(page.getByTestId("book-pane")).toHaveCount(0);
    // Still open on the grid: nothing was written.
    await expect(page.getByTestId("slot-state")).toHaveText("Open");
  });

  test("the old booking page is gone", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    const res = await page.goto(`/admin/calendar/book?date=${BOOKED.date}&vessel=${DEMO.vesselId}&time=${OPEN_TIME}`);
    expect(res?.status()).toBe(404);
  });

  test("a refused booking comes back on the form with what was typed", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=2`);
    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Kept Name");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "123");
    await page.getByTestId("book-phone").click();

    // Back in the pane, on the checkout step, for the same party.
    const pane = page.getByTestId("book-pane");
    await expect(pane.getByText("That mobile number doesn’t look right")).toBeVisible();
    await expect(pane.getByPlaceholder("Guest’s full name")).toHaveValue("Kept Name");
    await expect(pane.getByTestId("summary-total")).toBeVisible();
    await expect(page).toHaveURL(/guests=2/);
  });

  /**
   * The boat was taken out of service while the operator was on the phone (issue #1091). The
   * refusal used to land on a calendar with no pane and no message — the "blocked" copy only
   * renders on the checkout step, which needs the slot open. Now it lands on the blocked
   * departure's pane, which says nothing was booked and opens the block.
   */
  test("a booking refused because the boat was just blocked opens that block", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=2`);
    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Phone Caller");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0199");
    await plantVesselBlock({
      id: "block-e2e-mid-call",
      vesselId: DEMO.vesselId,
      startDate: BOOKED.date,
      endDate: BOOKED.date,
    });
    await page.getByTestId("book-phone").click();

    const pane = page.getByTestId("slot-pane");
    await expect(pane).toContainText("Blocked while you were booking — nothing was booked.");
    await expect(pane).toContainText("Brew 3 out of service");
    await expect(pane.getByRole("link", { name: "Open that block →" })).toHaveAttribute(
      "href",
      "/admin/blocks?sel=block-e2e-mid-call",
    );
  });

  test("more guests than the boat takes is refused on the passengers step", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=13`);
    await expect(page.getByText("Brew 3 takes 12")).toBeVisible();
    await expect(page.getByTestId("summary-total")).toHaveCount(0);
  });

  /**
   * The operator's discount (16.5, DEC-194). Dollars off; tax, fee and tip re-price live on what is
   * left; the pane's Owes is the discounted total, read off the form rather than pinned.
   */
  test("a partial discount re-prices live and is what the booking owes", async ({ page }, info) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=2`);
    const before = (await page.getByTestId("due-now").textContent())!.trim();
    await fillHydrated(page.getByTestId("discount"), "100");
    await expect(page.getByTestId("summary-discount")).toContainText("−$100.00");
    await expect(page.getByTestId("due-now")).not.toHaveText(before);
    await expect(page.getByTestId("discount-comp")).toHaveCount(0);
    const discounted = (await page.getByTestId("due-now").textContent())!.trim();
    await page.screenshot({ path: info.outputPath("discount-form.png"), fullPage: true });

    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Phone Caller");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0199");
    await page.getByTestId("book-phone").click();
    await page.waitForURL(/\/admin\/calendar\/resv-/);
    const pane = page.getByTestId("reservation-detail");
    await expect(pane.getByTestId("booking-state")).toHaveText("Awaiting payment");
    await expect(pane.getByTestId("money-discount")).toHaveText("−$100.00");
    await expect(pane.getByTestId("money-owes")).toHaveText(discounted);
  });

  test("the whole fare off is a comp: said before saving, booked at once, no payment link", async ({ page }, info) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=2`);
    await fillHydrated(page.getByTestId("discount"), "99999");
    await expect(page.getByTestId("discount-comp")).toHaveText("Under $2 due — this will be a comp.");
    await expect(page.getByTestId("due-now")).toHaveText("$0.00");
    await page.screenshot({ path: info.outputPath("comp-form.png"), fullPage: true });

    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Comp Guest");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0198");
    await page.getByTestId("book-phone").click();
    await page.waitForURL(/\/admin\/calendar\/resv-.*comped=1/);
    const pane = page.getByTestId("reservation-detail");
    await expect(pane.getByTestId("booking-state")).toHaveText("Booked");
    await expect(pane).toContainText("Booked as a comp — nothing to pay, so no payment link went out.");
    await expect(pane.getByTestId("money-owes")).toHaveText("Settled");
    await expect(pane.getByTestId("payment-link-controls")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("comp-pane.png"), fullPage: true });
  });

  test("a discount that isn't dollars is refused, and the form keeps what was typed", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=2`);
    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Kept Name");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0199");
    await fillHydrated(page.getByTestId("discount"), "1,50");
    await expect(page.getByText("Enter dollars, like 50 or 49.99.")).toBeVisible();
    await page.getByTestId("book-phone").click();
    const pane = page.getByTestId("book-pane");
    await expect(pane.getByText("Enter the discount in dollars")).toBeVisible();
    await expect(pane.getByTestId("discount")).toHaveValue("1,50");
    await expect(pane.getByPlaceholder("Guest’s full name")).toHaveValue("Kept Name");
  });

  test("no horizontal overflow (375px layout holds)", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${BOOK}&guests=2`);
    await expect(page.getByTestId("book-phone")).toBeVisible();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(fits).toBe(true);
  });
});
