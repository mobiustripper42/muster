/**
 * Customer checkout screen (task 12.5, #458, DEC-134) — drives the public `/book/checkout`
 * inline-Elements form.
 *
 * Uses the `reservation` seed (see book-availability.spec.ts): LIVE offering
 * "Reservation Demo Cruise" on Brew 3 (cap 12, included = cap), base $499, $50/extra guest,
 * owned a seven-day window late in NEXT month, departures 13:30/15:30/17:30, 13:30 on its third
 * day booked (Marcus Webb). Dates derived, never typed — see `e2e/reservation-demo.ts` (#646).
 * Payment config rides the defaults: FULL payment (issue #617 — the default was `deposit` at 25%
 * while nothing collected the balance), tax 7.25%, service fee 3% (DEC-134), tip tiers 15/20/25
 * with 20% preselected (DEC-124).
 *
 * Money pins for 2 guests at 15:30 (fare $499.00, no extras):
 *   tax $36.18 · fee $14.97 · tip20 $99.80 → total $649.95, and due-now is the SAME $649.95
 *   because nothing is deferred · tip15 $74.85 → total $625.00.
 *
 * **This spec inherits the default deliberately.** Pinning it to an explicit `deposit` override
 * would have kept these numbers stable and hidden the flip from the suite entirely — which is
 * exactly how #617's default survived a year of green runs.
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
  plantVesselBlock,
} from "./fixtures.js";
import { BOOKED, DEMO, OPEN_TIME, formatShortDay } from "./reservation-demo.js";

/** The stepper's landing value on `/book` — the offering's smallest boat (#715). Read off the
 *  fixture, because "2" was a constant that stopped being the default. */
const DEFAULT_GUESTS = DEMO.fleet[0]!.coiMaxPax;
/** What the base fare covers before the $40 per-head charge starts (`seed-reservation.ts`). The
 *  fare row names THIS, not the boat's capacity — the two coincided only while the offering left
 *  `includedGuestCount` unset, which also made the extra-guest price unreachable. A literal, like
 *  every other money figure pinned in this file. */
const INCLUDED = 10;

const CHECKOUT =
  `/book/checkout?offering=offering-reservation-demo&date=${BOOKED.date}&time=${OPEN_TIME}&guests=2`;

test.describe("public /book/checkout", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("renders the trip, the full money summary, and the sticky pay bar", async ({ page }) => {
    await page.goto(CHECKOUT);

    // Hero + trip block reflect the picked slot.
    await expect(page.getByRole("heading", { name: "Reservation Demo Cruise", level: 1 })).toBeVisible();
    // The app's own formatter builds the expectation, so a format change reddens here rather
    // than quietly disagreeing with a string this spec invented.
    await expect(page.getByText(`${formatShortDay(BOOKED.date)} · 3:30 PM`)).toBeVisible();
    await expect(page.getByText("· 2 guests")).toBeVisible();

    // Summary: fare · tip → crew · tax · fee · total (DEC-134 line items, honest about
    // where money goes — the tip is exempt from tax + fee and the rows reflect that).
    // What the base covers, not the hull's capacity — 2 guests are inside the included 10, so
    // there are no extras and the fare is the flat base.
    await expect(page.getByText(`Fare — up to ${INCLUDED} guests`)).toBeVisible();
    await expect(page.getByTestId("summary-tip")).toContainText("$99.80");
    await expect(page.getByText("Tax · 7.25%")).toBeVisible();
    await expect(page.getByTestId("summary-fee")).toContainText("$14.97");
    await expect(page.getByTestId("summary-fee")).toContainText("3%");
    await expect(page.getByTestId("summary-total")).toContainText("$649.95");

    // FULL payment (issue #617): one charge, nothing deferred. The deposit/balance block does
    // not render at all — asserted by absence, because its presence would mean the customer is
    // being quoted a balance that no mechanism collects.
    await expect(page.getByTestId("summary-due-now")).toHaveCount(0);
    await expect(page.getByText("Balance · due before your trip")).toHaveCount(0);
    await expect(page.getByTestId("due-now")).toHaveText("$649.95");

    // The inert future gift-card row renders disabled, not clickable-looking.
    await expect(page.getByText("Apply gift card or discount code")).toBeVisible();
  });

  test("changing the tip tile re-totals live (client island, no navigation)", async ({ page }) => {
    await page.goto(CHECKOUT);

    // 20% is preselected (DEC-124).
    await expect(page.getByTestId("tip-2000")).toHaveAttribute("aria-pressed", "true");

    await clickHydrated(page.getByTestId("tip-1500"));
    await expect(page.getByTestId("tip-1500")).toHaveAttribute("aria-pressed", "true");
    // Full payment (#617): due-now IS the total, so these two must agree — a divergence would
    // mean something is being deferred again.
    await expect(page.getByTestId("due-now")).toHaveText("$625.00");
    await expect(page.getByTestId("summary-total")).toContainText("$625.00");
    await expect(page.getByTestId("summary-tip")).toContainText("$74.85");

    await page.getByTestId("tip-2500").click();
    // tip25 = $124.75 → 499.00 + 36.18 + 14.97 + 124.75 = $674.90.
    await expect(page.getByTestId("due-now")).toHaveText("$674.90");
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

  test("the cancellation terms are stated above the pay button (#619)", async ({ page }) => {
    await page.goto(CHECKOUT);

    // The literal expected sight — the operator's published policy. The unit suite
    // (`src/reservations/refund-terms.test.ts`) is what pins this prose to the $50/14-day
    // constants; this asserts the customer actually sees it before handing over a card.
    const terms = page.getByTestId("cancellation-terms");
    await expect(terms).toBeVisible();
    await expect(terms).toContainText(
      "Cancel 14 days or more before your cruise for a refund minus a $50 cancellation fee.",
    );
    await expect(terms).toContainText("no-shows");
    await expect(terms).toContainText("full refund");

    // Flex insurance is a published term nothing can sell yet (#683) — it must NOT appear
    // at the point of sale.
    await expect(terms).not.toContainText(/insurance/i);

    // "Before the pay button" is the acceptance criterion, so assert the ORDER, not just
    // co-presence: the terms box precedes the sticky pay bar in the document.
    const order = await terms.evaluate((el) => {
      const pay = document.querySelector('[data-testid="book-pay"]')!;
      return el.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING ? "before" : "after";
    });
    expect(order).toBe("before");
  });

  test("a stale link to a sold-out slot gets an honest notice, not a doomed form", async ({ page }) => {
    // The seeded Marcus Webb booking takes Brew 3's 13:30. Since #715 the offering carries two
    // more hulls, so that ALONE no longer sells the departure out — the other two have to be off
    // the water for this to be the sold-out case the test is named for. Without these blocks the
    // page renders a perfectly good form and the assertion below tests nothing.
    for (const boat of DEMO.fleet.filter((f) => f.vesselId !== DEMO.vesselId)) {
      await plantVesselBlock({
        id: `blk-soldout-${boat.vesselId}`,
        vesselId: boat.vesselId,
        startDate: BOOKED.date,
        endDate: BOOKED.date,
      });
    }
    await page.goto(
      `/book/checkout?offering=offering-reservation-demo&date=${BOOKED.date}&time=${BOOKED.time}&guests=2`,
    );
    await expect(
      page.getByRole("heading", { name: "That departure is no longer available" }),
    ).toBeVisible();
    await expect(page.getByText("Nothing was charged.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Pick another time" })).toBeVisible();
    await expect(page.getByTestId("book-pay")).toHaveCount(0); // no form rendered
  });

  /**
   * "Change" is a round trip, not a reset (#715).
   *
   * `backHref` carried only the offering and the date, so returning to the availability screen
   * dropped the party size AND the departure — the count fell back to the offering's smallest
   * boat and the customer had to re-pick both. That is the "guests reset when you navigate"
   * wrinkle this issue exists to kill, surviving on the one edge that leaves the page: a party of
   * 14 tapped Change and came back as a party of 12.
   */
  test("Change returns to the availability screen with the party and the time intact", async ({ page }) => {
    await page.goto(
      `/book/checkout?offering=offering-reservation-demo&date=${BOOKED.date}&time=${OPEN_TIME}&guests=14`,
    );
    await expect(page.getByText("· 14 guests")).toBeVisible();

    await page.getByRole("link", { name: "Change" }).click();
    await page.waitForURL(/\/book\?/);

    await expect(page).toHaveURL(/guests=14/);
    await expect(page).toHaveURL(new RegExp(`date=${BOOKED.date}`));
    await expect(page).toHaveURL(/time=15/); // colon-encoded
    await expect(page.getByTestId("guest-count")).toHaveText("14");
  });

  test("a guest count over the boat's cap is refused up front", async ({ page }) => {
    await page.goto(
      `/book/checkout?offering=offering-reservation-demo&date=${BOOKED.date}&time=${OPEN_TIME}&guests=99`,
    );
    await expect(
      page.getByRole("heading", { name: "That departure is no longer available" }),
    ).toBeVisible();
  });

  test("the availability screen's Continue link lands here with the same slot + guests", async ({ page }) => {
    await page.goto(`/book?date=${BOOKED.date}`);
    await page.getByTestId("continue").click();

    await expect(page).toHaveURL(/\/book\/checkout\?offering=offering-reservation-demo/);
    await expect(page).toHaveURL(new RegExp(`date=${BOOKED.date}`));
    await expect(page).toHaveURL(new RegExp(`guests=${DEFAULT_GUESTS}`));
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
