/**
 * Customer checkout screen (task 12.5, #458, DEC-134) — drives the public `/book/checkout`
 * inline-Elements form.
 *
 * Uses the `reservation` seed (see book-availability.spec.ts): LIVE offering
 * "Reservation Demo Cruise" on Brew 3 (cap 12, included = cap), base $499, $50/extra guest,
 * owned a seven-day window late in NEXT month, departures 13:30/15:30/17:30, 13:30 on its third
 * day booked (Marcus Webb). Dates derived, never typed — see `e2e/reservation-demo.ts` (#646).
 * Payment config rides the defaults: a $100 deposit offered on a departure outside the 30-day
 * balance window, the whole quote inside it (issue #1250), tax 7.25%, service fee 3% (DEC-134), tip
 * tiers 15/20/25 with 20% preselected (DEC-124).
 *
 * Money pins for 2 guests at 15:30 (fare $499.00, no extras):
 *   tax $36.18 · tip20 $99.80 · fee $17.96 (3% of fare + tip, DEC-196) → total $652.94; inside the
 *   balance window due-now is the SAME $652.94, outside it the deposit leaves $552.94 · tip15
 *   $74.85 → fee $17.22 → total $627.25.
 *
 * **The specs that pin due-now to the total use a departure inside the window**
 * (`INSIDE_BALANCE_WINDOW`), and the deposit specs one outside it (`OUTSIDE_BALANCE_WINDOW`): the
 * seeded week moves with today, so pointing either at it would make the answer depend on the date.
 *
 * **This spec inherits the default deliberately.** Pinning it to an explicit override would have
 * kept these numbers stable and hidden a flip of the default from the suite entirely — which is
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
  fillHydrated,
  plantVesselBlock,
} from "./fixtures.js";
import type { Page } from "@playwright/test";
import {
  BOOKED,
  DEMO,
  INSIDE_BALANCE_WINDOW,
  OPEN_TIME,
  OUTSIDE_BALANCE_WINDOW,
  formatShortDay,
} from "./reservation-demo.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { TEST_DATABASE_URL } from "../db/reset-test.js";
import { addDays } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import { PAYMENT_CONFIG_DEFAULTS } from "../src/reservations/payment-config.js";

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

/**
 * The same trip and party on a day INSIDE the balance window (issue #1250): the whole quote is due
 * now and no payment choice is shown. The specs that assert due-now equals the total point here, so
 * they do not turn on which side of the window the seeded week falls this month.
 */
const INSIDE_CHECKOUT =
  `/book/checkout?offering=offering-reservation-demo&date=${INSIDE_BALANCE_WINDOW}&time=${OPEN_TIME}&guests=2`;

/** The same trip and party on a day OUTSIDE the balance window (issue #1250): a deposit is offered. */
const OUTSIDE_CHECKOUT =
  `/book/checkout?offering=offering-reservation-demo&date=${OUTSIDE_BALANCE_WINDOW}&time=${OPEN_TIME}&guests=2`;

/** The day the balance is charged for the outside-window departure, as the page writes it: the
 *  departure date less the balance-due setting, which `resetAndSeed` leaves at its default. */
const BALANCE_DUE_ON = formatShortDay(
  addDays(OUTSIDE_BALANCE_WINDOW, -PAYMENT_CONFIG_DEFAULTS.balanceDueDaysBeforeEvent),
);

/**
 * Run the demo offering's season through `date`. The seed's season ends with the seeded week, and a
 * departure far enough out to be outside the balance window can fall after it — late in a month it
 * always does. Written through the port, as `booking-cutoff.spec.ts` sets its cutoff.
 */
async function extendSeasonThrough(date: string): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const offering = (await repo.getOffering(asId<"OfferingId">(DEMO.offeringId)))!;
    if (offering.schedule.seasonEnd >= date) return;
    await repo.saveOffering({ ...offering, schedule: { ...offering.schedule, seasonEnd: date } });
  } finally {
    await repo.close();
  }
}

/** The pay bar's figures: its label, the due-now figure and, for a deposit, the total under it. */
const payBar = (page: Page) => page.getByTestId("due-now").locator("..");

/** The terms box — the label the required tick belongs to (#1112). */
const termsBox = (page: Page) => page.locator("label", { has: page.getByTestId("agree-terms") });

/**
 * A stand-in for Stripe.js whose payment never settles (issue #1082 part A). The e2e has no Stripe
 * network, so without this the form never reaches "paying" and the in-flight lock is untestable.
 * Just enough for `@stripe/react-stripe-js` to accept it (`isStripe`: `elements`, `createToken`,
 * `createPaymentMethod`, `confirmCardPayment`) and for the Payment Element to mount; `submit()`
 * returns a promise that never resolves, which holds the checkout in flight.
 */
const HANGING_STRIPE_JS = `
  (function () {
    function element() {
      var el = { mount: function () {}, unmount: function () {}, destroy: function () {}, update: function () {},
        focus: function () {}, blur: function () {}, clear: function () {}, collapse: function () {} };
      el.on = el.off = el.once = function () { return el; };
      return el;
    }
    window.Stripe = function () {
      return {
        elements: function () {
          return { create: element, getElement: function () { return null; },
            update: function () { return Promise.resolve(); },
            fetchUpdates: function () { return Promise.resolve({}); },
            submit: function () { return new Promise(function () {}); } };
        },
        createToken: function () {}, createPaymentMethod: function () {}, confirmCardPayment: function () {},
        confirmPayment: function () { return new Promise(function () {}); },
        registerAppInfo: function () {}, _registerWrapper: function () {},
      };
    };
  })();
`;

test.describe("public /book/checkout", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("renders the trip, the full money summary, and the sticky pay bar", async ({ page }) => {
    // Inside the balance window, so the whole quote is due now (issue #1250).
    await page.goto(INSIDE_CHECKOUT);

    // Hero + trip block reflect the picked slot.
    await expect(page.getByRole("heading", { name: "Reservation Demo Cruise", level: 1 })).toBeVisible();
    // The app's own formatter builds the expectation, so a format change reddens here rather
    // than quietly disagreeing with a string this spec invented.
    await expect(page.getByText(`${formatShortDay(INSIDE_BALANCE_WINDOW)} · 3:30 PM`)).toBeVisible();
    await expect(page.getByText("· 2 guests")).toBeVisible();

    // Summary: fare · tip → crew · tax · fee · total (DEC-134 line items, honest about
    // where money goes — the tip is exempt from tax + fee and the rows reflect that).
    // What the base covers, not the hull's capacity — 2 guests are inside the included 10, so
    // there are no extras and the fare is the flat base.
    await expect(page.getByText(`Fare — up to ${INCLUDED} guests`)).toBeVisible();
    await expect(page.getByTestId("summary-tip")).toContainText("$99.80");
    await expect(page.getByText("Tax · 7.25%")).toBeVisible();
    await expect(page.getByTestId("summary-fee")).toContainText("$17.96");
    await expect(page.getByTestId("summary-fee")).toContainText("3%");
    await expect(page.getByTestId("summary-total")).toContainText("$652.94");

    // Inside the balance window: one charge, nothing deferred. The deposit/balance block does not
    // render at all — asserted by absence, because its presence would mean a balance is being quoted.
    await expect(page.getByTestId("summary-due-now")).toHaveCount(0);
    await expect(page.getByText("Balance · due before your trip")).toHaveCount(0);
    await expect(page.getByTestId("due-now")).toHaveText("$652.94");

    // The inert future gift-card row renders disabled, not clickable-looking.
    await expect(page.getByText("Apply gift card or discount code")).toBeVisible();
  });

  test("changing the tip tile re-totals live (client island, no navigation)", async ({ page }) => {
    // Inside the balance window, so the whole quote is due now (issue #1250).
    await page.goto(INSIDE_CHECKOUT);

    // 20% is preselected (DEC-124).
    await expect(page.getByTestId("tip-2000")).toHaveAttribute("aria-pressed", "true");

    await clickHydrated(page.getByTestId("tip-1500"));
    await expect(page.getByTestId("tip-1500")).toHaveAttribute("aria-pressed", "true");
    // Inside the window due-now IS the total, so these two must agree — a divergence would mean
    // something is being deferred.
    await expect(page.getByTestId("due-now")).toHaveText("$627.25");
    await expect(page.getByTestId("summary-total")).toContainText("$627.25");
    await expect(page.getByTestId("summary-tip")).toContainText("$74.85");
    // The fee moves with the tip (DEC-196).
    await expect(page.getByTestId("summary-fee")).toContainText("$17.22");

    await page.getByTestId("tip-2500").click();
    // tip25 = $124.75, fee 3% of 499 + 124.75 = $18.71 → 499.00 + 36.18 + 124.75 + 18.71 = $678.64.
    await expect(page.getByTestId("due-now")).toHaveText("$678.64");
    await expect(page).toHaveURL(/time=15/); // same server render — the island did the math
  });

  /**
   * The one box at checkout is the cancellation terms (issue #1112) — not a waiver. The waiver is
   * its own module, signed per guest (lane A); nothing here says "waiver" any more.
   */
  test("the cancellation-terms box gates Book & pay; nothing calls it a waiver", async ({ page }) => {
    await page.goto(CHECKOUT);

    const pay = page.getByTestId("book-pay");
    await expect(pay).toBeVisible();
    await expect(pay).toBeDisabled();
    await expect(page.getByText("I agree to the cancellation terms:")).toBeVisible();
    await expect(page.getByText(/waiver/i)).toHaveCount(0);

    await setCheckedHydrated(page.getByTestId("agree-terms"), true);
    await expect(pay).toBeEnabled();

    await setCheckedHydrated(page.getByTestId("agree-terms"), false);
    await expect(pay).toBeDisabled();
  });

  /**
   * Once Book & pay is pressed, nothing on the page can be used until the payment settles (issue
   * #1082 part A). The form body went inert at #997, but the header's ‹ and the trip card's Change
   * are drawn by the page, outside it — a guest could leave mid-charge and land on the date picker
   * as if they had not paid.
   */
  test("while a payment is in flight, ‹ and Change are locked with the rest of the form", async ({ page }) => {
    await page.route("https://js.stripe.com/**", (route) =>
      route.fulfill({ contentType: "application/javascript", body: HANGING_STRIPE_JS }),
    );
    await page.goto(CHECKOUT);

    const back = page.getByRole("link", { name: "Back to date & time" });
    const change = page.getByRole("link", { name: "Change" });
    const locked = (l: typeof back) => l.evaluate((el) => el.closest("[inert]") !== null);
    // Usable before paying — the guard is the payment, not the page.
    expect(await locked(back)).toBe(false);
    expect(await locked(change)).toBe(false);

    await fillHydrated(page.getByPlaceholder("Full name"), "Mid Charge");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0100");
    await setCheckedHydrated(page.getByTestId("agree-terms"), true);
    await clickHydrated(page.getByTestId("book-pay"));
    await expect(page.getByTestId("checkout-busy")).toBeVisible();

    expect(await locked(back)).toBe(true);
    expect(await locked(change)).toBe(true);
    // And they grey out with the form, not only stop working (operator, 2026-09-29): the header and
    // the trip card each carry the form's wash.
    await expect(page.getByTestId("locked-wash")).toHaveCount(2);
  });

  test("the cancellation terms are stated above the pay button, in the box's own label (#619, #1112)", async ({ page }) => {
    await page.goto(CHECKOUT);

    // The literal expected sight — the operator's published policy. The unit suite
    // (`src/reservations/refund-terms.test.ts`) is what pins this prose to the $50/14-day
    // constants; this asserts the customer actually sees it before handing over a card.
    const terms = page.getByTestId("cancellation-terms");
    await expect(terms).toBeVisible();
    await expect(terms).toContainText(
      "Cancel 14 days or more before your cruise for a refund minus a $50 cancellation fee.",
    );
    // The terms ARE the box's label (#1112): what is ticked is exactly what is read.
    await expect(page.locator("label", { has: page.getByTestId("agree-terms") }).getByTestId("cancellation-terms")).toBeVisible();
    await expect(terms).toContainText("no-shows");
    await expect(terms).toContainText("full refund");

    // The terms don't sell insurance — the box above does (operator, 2026-10-13).
    await expect(terms).not.toContainText("insurance");

    // "Before the pay button" is the acceptance criterion, so assert the ORDER, not just
    // co-presence: the terms box precedes the sticky pay bar in the document.
    const order = await terms.evaluate((el) => {
      const pay = document.querySelector('[data-testid="book-pay"]')!;
      return el.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING ? "before" : "after";
    });
    expect(order).toBe("before");
  });

  /**
   * Cancellation insurance (16.8, issue #683): optional, $30 flat, taxed and in the fee base, never
   * in the tip. Ticking it adds the row and re-totals the tax and fee, and the terms box beside the
   * pay button turns to the insured terms. A tick given to the 14-day terms is not agreement to
   * these, so it is cleared.
   */
  test("cancellation insurance adds a $30 row, re-totals tax and fee, and the terms turn to 72 hours", async ({ page }, info) => {
    // Inside the balance window, so due-now is the whole quote (issue #1250, operator 2026-11-10).
    await page.goto(INSIDE_CHECKOUT);
    const box = page.getByTestId("add-insurance");
    await expect(page.getByText("Add cancellation insurance — $30")).toBeVisible();
    await expect(page.getByText("Cancel up to 72 hours before your cruise instead of 14 days, with no cancellation fee.")).toBeVisible();
    await expect(box).not.toBeChecked();
    await expect(page.getByTestId("summary-insurance")).toHaveCount(0);

    await setCheckedHydrated(page.getByTestId("agree-terms"), true);
    await setCheckedHydrated(box, true);

    // The operator's grid (DEC-196): insurance is taxed and in the fee base, the tip is not taxed.
    // Tax 7.25% of 499 + 30 = $38.35; fee 3% of 499 + 30 + 99.80 = $18.86; total $686.01.
    await expect(page.getByTestId("summary-insurance")).toHaveText(/Cancellation insurance\s*\$30\.00/);
    await expect(page.getByText("Tax · 7.25%").locator("..")).toContainText("$38.35");
    await expect(page.getByTestId("summary-fee")).toContainText("$18.86");
    await expect(page.getByTestId("summary-tip")).toContainText("$99.80");
    await expect(page.getByTestId("summary-total")).toContainText("$686.01");
    await expect(page.getByTestId("due-now")).toHaveText("$686.01");
    // The row sits after the service fee, before the total.
    const top = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
    expect(await top("summary-fee")).toBeLessThan(await top("summary-insurance"));
    expect(await top("summary-insurance")).toBeLessThan(await top("summary-total"));

    await expect(page.getByTestId("cancellation-terms")).toHaveText(
      "Cancel 72 hours or more before your cruise for a full refund, less the $30 insurance. Cancellations less than 72 hours out are non-refundable, as are no-shows. If we cancel for inclement weather, you'll receive a full refund.",
    );
    await expect(page.getByTestId("agree-terms")).not.toBeChecked();
    await expect(page.getByTestId("book-pay")).toBeDisabled();
    await page.screenshot({ path: info.outputPath("checkout-insurance.png"), fullPage: true });

    // Unticked, everything goes back.
    await setCheckedHydrated(box, false);
    await expect(page.getByTestId("summary-insurance")).toHaveCount(0);
    await expect(page.getByTestId("due-now")).toHaveText("$652.94");
    await expect(page.getByTestId("cancellation-terms")).toContainText("Cancel 14 days or more");
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

  /**
   * The deposit at checkout (issue #1250, `docs/SPEC.md §2.8.4d`) on the built page — the same trip,
   * party and tip as the money pins above ($652.94), on a departure pinned at least 40 days out, so
   * a $100 deposit is offered whatever the date. The wording is `depositCopy`'s, pinned in
   * `components/checkout/money.test.ts`; these check that the form renders it, preselects the
   * deposit, and follows the choice.
   */
  test.describe("a departure outside the balance window", () => {
    test.beforeEach(async () => {
      await extendSeasonThrough(OUTSIDE_BALANCE_WINDOW);
    });

    test("AC16: the payment choice shows Pay deposit · $100.00 preselected, its balance under it, and Pay in full · $652.94", async ({ page }) => {
      await page.goto(OUTSIDE_CHECKOUT);

      await expect(page.getByText("Pay deposit · $100.00", { exact: true })).toBeVisible();
      await expect(page.getByText(`$552.94 charged to this card on ${BALANCE_DUE_ON}`, { exact: true })).toBeVisible();
      await expect(page.getByText("Pay in full · $652.94", { exact: true })).toBeVisible();

      // Preselected: before anything is tapped, the pay bar asks for the deposit, with the total
      // under it.
      await expect(page.getByTestId("due-now")).toHaveText("$100.00");
      await expect(payBar(page)).toHaveText(/^Due now\s*\$100\.00\s*\$652\.94 total$/);
    });

    test("AC14: with Pay deposit chosen the terms box ends with the balance line, and Pay in full removes it", async ({ page }) => {
      await page.goto(OUTSIDE_CHECKOUT);

      await expect(termsBox(page)).toHaveText(
        new RegExp(`We'll charge the balance of \\$552\\.94 to this card on ${BALANCE_DUE_ON}\\.$`),
      );

      await clickHydrated(page.getByText("Pay in full · $652.94", { exact: true }));
      await expect(page.getByTestId("due-now")).toHaveText("$652.94");
      await expect(termsBox(page)).not.toContainText("We'll charge the balance");
    });

    test("AC15: choosing Pay in full puts the whole quote due now — the pay bar reads Total $652.94 and the summary's deposit rows go", async ({ page }) => {
      await page.goto(OUTSIDE_CHECKOUT);
      await expect(page.getByTestId("summary-due-now")).toContainText("$100.00");

      await clickHydrated(page.getByText("Pay in full · $652.94", { exact: true }));
      await expect(payBar(page)).toHaveText(/^Total\s*\$652\.94$/);
      await expect(page.getByTestId("summary-due-now")).toHaveCount(0);
      await expect(page.getByText("Balance · due before your trip")).toHaveCount(0);
    });
  });

  test("AC16: inside the balance window no payment choice is shown", async ({ page }) => {
    await page.goto(INSIDE_CHECKOUT);
    await expect(page.getByTestId("due-now")).toHaveText("$652.94");
    await expect(page.getByText(/^Pay deposit · /)).toHaveCount(0);
    await expect(page.getByText(/^Pay in full · /)).toHaveCount(0);
  });
});
