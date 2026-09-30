/**
 * The payment link (issue #1082 part B) — the operator books by phone, the link goes to the customer,
 * and the customer pays (or cancels) on `/p/<link>`.
 *
 * The e2e has no Stripe network and no live text or email, so this drives everything up to the card
 * and stops there, as `book-checkout.spec.ts` does: the page, its order and wording, the terms gate,
 * the in-flight lock (with the same hanging Stripe.js stand-in), the cancel, and every state that
 * isn't payable. The paying itself — intent, confirm, the races — is `pay-by-link.test.ts`.
 *
 * `reservation` seed: the demo cruise on Brew 3, 15:30 open on the booked day, the booked 13:30 is
 * Marcus Webb's (a paid booking).
 *
 * Runs desktop + 375px (registered in the mobile testMatch).
 */
import type { Browser, Page } from "@playwright/test";
import { signPaymentLink } from "../src/reservations/payment-link.js";
import { shortTime } from "../src/reservations/calendar-grid.js";
import {
  test,
  expect,
  clickHydrated,
  fillHydrated,
  resetAndSeed,
  setCheckedHydrated,
  signInAsAdmin,
} from "./fixtures.js";
import { TEST_DATABASE_URL } from "../db/reset-test.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { BOOKED, DEMO, OPEN_TIME, formatShortDay } from "./reservation-demo.js";

/** The secret the e2e server signs with (`playwright.config.ts` pins the same expression). */
const SECRET = process.env.SESSION_SECRET ?? "e2e-test-secret";

const BOOK = `/admin/calendar?date=${BOOKED.date}&hold=${encodeURIComponent(`${DEMO.vesselId}|${OPEN_TIME}`)}&book=1&guests=2`;

/** Stripe.js whose payment never settles — `book-checkout.spec.ts`'s stand-in, for the in-flight lock. */
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

/** Book 2 guests at 15:30 by phone, and return the pane's page and what the booking owes. */
async function bookByPhone(page: Page): Promise<{ owes: string }> {
  await signInAsAdmin(page, "eric");
  await page.goto(BOOK);
  await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Phone Caller");
  await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0199");
  await page.getByTestId("book-phone").click();
  await page.waitForURL(/\/admin\/calendar\/resv-/);
  const owes = (await page.getByTestId("money-owes").textContent())!.trim();
  return { owes };
}

/**
 * Press Copy payment link and read what landed on the clipboard — the press IS the copy (operator,
 * 2026-09-29: a button with those words must put the link on the clipboard, not reveal it).
 */
async function copiedLink(page: Page): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const pane = page.getByTestId("reservation-detail");
  await clickHydrated(pane.getByRole("button", { name: "Copy payment link" }));
  await expect(pane.getByRole("button", { name: "Copied ✓" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // The same link is on the line under the button, for reading out on the phone.
  await expect(pane.getByTestId("pay-link")).toHaveText(copied);
  // Only the path: the host is the configured origin, and the test visits the server it runs.
  return new URL(copied).pathname;
}

/** The booking as the confirm leaves it once paid — written straight to the test DB, because the
 *  e2e has no Stripe to pay through (the confirm itself is `pay-by-link.test.ts`). */
async function markPaid(reservationId: string): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const r = await repo.getReservation(reservationId as never);
    await repo.saveReservation({ ...r!, source: "muster", status: "booked" });
  } finally {
    await repo.close();
  }
}

/** The customer's own browser: no admin session behind them, at the viewport this project runs. */
async function asCustomer(browser: Browser, like: Page, baseURL: string | undefined, path: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL, viewport: like.viewportSize() });
  const page = await ctx.newPage();
  await page.goto(path);
  return page;
}

test.describe("the payment link", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("booking by phone sends it (and says where); the pane copies it and says how long it works", async ({ page }) => {
    await bookByPhone(page);
    const pane = page.getByTestId("reservation-detail");
    await expect(pane).toContainText("Booked. The boat is held for Phone Caller");
    // The e2e has no live text or email, so the link can't have gone anywhere — and the pane says so
    // rather than claiming it was sent.
    await expect(pane).toContainText("The payment link wasn’t sent — no text or email is set up on this deployment.");

    await expect(pane.getByRole("button", { name: "Send payment link" })).toBeVisible();
    await expect(pane).toContainText("The link works for 72 hours.");
    const path = await copiedLink(page);
    expect(path).toMatch(/^\/p\/[\w-]{22}\.[0-9a-z]{6}\.[\w-]{22}$/);

    // Send payment link again: same honesty.
    await pane.getByRole("button", { name: "Send payment link" }).click();
    await expect(pane.getByTestId("reservation-actions")).toContainText("The payment link wasn’t sent");
  });

  test("the pay page: the trip, who it's for, the frozen money, the terms box, Pay — in that order", async ({ page, browser, baseURL }) => {
    const { owes } = await bookByPhone(page);
    const customer = await asCustomer(browser, page, baseURL, await copiedLink(page));

    await expect(customer.getByText("Pay for your trip")).toBeVisible();
    await expect(customer.getByText("🔒 Secure")).toBeVisible();
    // No ‹ and no Change: the operator set the trip, and there's no picker behind this page.
    await expect(customer.getByRole("link", { name: "Back to date & time" })).toHaveCount(0);
    await expect(customer.getByRole("link", { name: "Change" })).toHaveCount(0);

    await expect(customer.getByRole("heading", { name: "Reservation Demo Cruise", level: 1 })).toBeVisible();
    await expect(customer.getByTestId("pay-trip")).toHaveText(`${formatShortDay(BOOKED.date)} · ${shortTime(OPEN_TIME)} PM · 2 guests`);
    await expect(customer.getByTestId("booked-for")).toHaveText("Phone Caller · (216) 555-0199");
    // Nothing to fill in, and the tip is the operator's.
    await expect(customer.getByPlaceholder("Full name")).toHaveCount(0);
    await expect(customer.getByTestId("tip-1500")).toHaveCount(0);

    await expect(customer.getByText("Fare", { exact: true })).toBeVisible();
    await expect(customer.getByTestId("summary-tip")).toContainText("Tip your crew · 20% → crew");
    await expect(customer.getByText("Tax · 7.25%")).toBeVisible();
    await expect(customer.getByTestId("summary-fee")).toContainText("Service fee · 3%");
    // What the customer pays is what the operator's pane says they owe.
    await expect(customer.getByTestId("summary-total")).toContainText(owes);
    await expect(customer.getByTestId("due-now")).toHaveText(owes);

    const pay = customer.getByTestId("pay-now");
    await expect(pay).toHaveText("🔒 Pay");
    await expect(pay).toBeDisabled();
    await expect(customer.getByText("I agree to the cancellation terms:")).toBeVisible();
    await setCheckedHydrated(customer.getByTestId("agree-terms"), true);
    await expect(pay).toBeEnabled();

    // Order on the page: trip, booked for, summary, terms, Pay, then the cancel.
    const top = async (testId: string) => (await customer.getByTestId(testId).boundingBox())!.y;
    const order = [
      await top("pay-trip"),
      await top("booked-for"),
      await top("summary-total"),
      await top("agree-terms"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await expect(customer.getByRole("link", { name: "Can’t make it? Cancel this booking" })).toBeVisible();
  });

  test("while a payment is in flight, the cancel is locked and greyed with the form", async ({ page, browser, baseURL }) => {
    await bookByPhone(page);
    const path = await copiedLink(page);
    const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize() });
    const customer = await ctx.newPage();
    await customer.route("https://js.stripe.com/**", (route) =>
      route.fulfill({ contentType: "application/javascript", body: HANGING_STRIPE_JS }),
    );
    await customer.goto(path);

    const cancel = customer.getByRole("link", { name: "Can’t make it? Cancel this booking" });
    expect(await cancel.evaluate((el) => el.closest("[inert]") !== null)).toBe(false);
    await setCheckedHydrated(customer.getByTestId("agree-terms"), true);
    await clickHydrated(customer.getByTestId("pay-now"));
    await expect(customer.getByTestId("checkout-busy")).toBeVisible();

    expect(await cancel.evaluate((el) => el.closest("[inert]") !== null)).toBe(true);
    await expect(customer.getByTestId("locked-wash")).toBeVisible();
  });

  /** The abort path first: Keep it must leave the booking payable. */
  test("Can't make it: Keep it keeps it; Cancel booking cancels, and the operator's pane shows it", async ({ page, browser, baseURL }) => {
    await bookByPhone(page);
    const paneUrl = page.url();
    const customer = await asCustomer(browser, page, baseURL, await copiedLink(page));

    await customer.getByRole("link", { name: "Can’t make it? Cancel this booking" }).click();
    const confirm = customer.getByTestId("pay-cancel-confirm");
    await expect(confirm).toContainText(
      `Cancel your ${shortTime(OPEN_TIME)} PM trip on ${formatShortDay(BOOKED.date)}? Nothing has been charged.`,
    );
    await confirm.getByRole("link", { name: "Keep it" }).click();
    await expect(customer.getByTestId("pay-cancel-confirm")).toHaveCount(0);
    await expect(customer.getByTestId("pay-now")).toBeVisible();

    await customer.getByRole("link", { name: "Can’t make it? Cancel this booking" }).click();
    await customer.getByTestId("pay-cancel-confirm").getByRole("button", { name: "Cancel booking" }).click();
    // The cancelled card, shaped like "You're booked!" (operator, 2026-09-29).
    const cancelled = async () => {
      const card = customer.getByTestId("pay-state");
      await expect(card.getByRole("heading", { name: "Booking cancelled", level: 1 })).toBeVisible();
      await expect(card).toContainText(
        `Your ${shortTime(OPEN_TIME)} PM trip on ${formatShortDay(BOOKED.date)} has been cancelled.`,
      );
      await expect(card).toContainText(
        "Nothing was charged. Your card was never charged for this trip, so there’s nothing to refund and nothing you need to do.",
      );
      await expect(card).toContainText("Changed your mind? You’re welcome to book again any time.");
      await expect(card.getByRole("link", { name: "Book a trip →" })).toHaveAttribute("href", "/book");
      await expect(customer.getByTestId("pay-now")).toHaveCount(0);
    };
    await cancelled();

    // Opened again later: the same card, and still nothing to pay.
    await customer.goto(customer.url().split("?")[0]!);
    await cancelled();

    await page.goto(paneUrl.split("?")[0]!);
    await expect(page.getByTestId("booking-state")).toHaveText("Cancelled");
    await expect(page.getByLabel("Booking history")).toContainText("Cancelled");
  });

  test("an expired or tampered link says so, and offers no form", async ({ page }) => {
    const id = "resv-0123456789abcdef0123456789abcdef";
    const expired = signPaymentLink(id, new Date(Date.now() - 73 * 3_600_000), SECRET);
    await page.goto(`/p/${expired}`);
    await expect(page.getByTestId("pay-state")).toHaveText("This payment link has expired. Ask BrewBoat for a new one.");
    await expect(page.getByTestId("pay-now")).toHaveCount(0);

    const live = signPaymentLink(id, new Date(), SECRET);
    await page.goto(`/p/${live.slice(0, -2)}xx`);
    await expect(page.getByTestId("pay-state")).toHaveText("This payment link has expired. Ask BrewBoat for a new one.");
  });

  test("a paid trip says so and points at Find your booking — never at the booking link itself", async ({ page, browser, baseURL }) => {
    await bookByPhone(page);
    const path = await copiedLink(page);
    // Paid, as the confirm leaves it: the operator's row turned `muster` and booked.
    await markPaid(decodeURIComponent(page.url().split("/admin/calendar/")[1]!.split("?")[0]!));
    const customer = await asCustomer(browser, page, baseURL, path);
    const state = customer.getByTestId("pay-state");
    await expect(state).toContainText("This trip is already paid. Your booking link is in the text");
    await expect(state).toContainText("we sent to (216) 555-…99.");
    await expect(state.getByRole("link", { name: "Lost it? Find your booking" })).toHaveAttribute("href", "/b/find");
    await expect(customer.locator('a[href^="/b/"]:not([href="/b/find"])')).toHaveCount(0);
    await expect(customer.getByTestId("pay-now")).toHaveCount(0);
  });

  test("no horizontal overflow (375px layout holds)", async ({ page, browser, baseURL }) => {
    await bookByPhone(page);
    const customer = await asCustomer(browser, page, baseURL, await copiedLink(page));
    await expect(customer.getByTestId("pay-now")).toBeVisible();
    const fits = await customer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(fits).toBe(true);
  });
});
