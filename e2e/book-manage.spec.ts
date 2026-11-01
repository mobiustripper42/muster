/**
 * Customer "Your booking" manage page (task 12.6, #459) — the `/b/<code>` landing (DEC-154,
 * which reversed DEC-122's stateless-HMAC mechanism at #741).
 *
 * Uses the `reservation` seed: a booked trip at 13:30 on the 12th of next month (Marcus Webb,
 * fare $549, dates derived per #646) on the live "Reservation Demo Cruise". The trip is in the
 * FUTURE relative to the test clock, so the page renders its UPCOMING state (the completed
 * state's phase flip is unit-tested in manage-view.test). Runs desktop + 375px.
 *
 * Codes come from the seed's own derivation (`demoBookingCode`), not from a mirrored algorithm
 * in this file — the old spec re-implemented the server's HMAC here, which could drift from the
 * implementation with every test still green.
 */
import type { Page } from "@playwright/test";
import { addDays } from "../src/config/tenant.js";
import { formatClock, formatShortDay } from "../src/reservations/availability-screen.js";
import {
  test,
  expect,
  bookingCodeFor,
  cancelReservationRow,
  eventIdOfReservation,
  moveEventDate,
  plantWaiverTemplate,
  reservationIdFor,
  resetAndSeed,
} from "./fixtures.js";
import {
  BOOKED,
  BOOKED_3,
  TODAY,
  demoBookingCode,
  demoRevokedBookingCode,
  demoReservationId,
} from "./reservation-demo.js";

const RID = demoReservationId(BOOKED.date, BOOKED.time);
const CODE = demoBookingCode(RID);
const REVOKED = demoRevokedBookingCode(RID);

const manageUrl = (code = CODE) => `/b/${code}`;

test.describe("public /b/<code>", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("a valid link opens Your booking with trip, money, and actions", async ({ page }) => {
    await page.goto(manageUrl());

    await expect(page.getByText("Your booking", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reservation Demo Cruise" })).toBeVisible();
    await expect(page.getByText("Marcus Webb")).toBeVisible();
    await expect(page.getByText("Confirmed")).toBeVisible(); // future trip ⇒ upcoming
    await expect(page.getByText("Save this link")).toBeVisible();

    // Money: fare $549, tax $39.80 (7.25%), nothing paid, balance $588.80 — no Payment rows seeded.
    await expect(page.getByText("$549.00")).toBeVisible();
    await expect(page.getByText("$588.80")).toBeVisible();

    // The manage actions. Post-trip tip tiers were asserted here until 15.18 removed them.
    await expect(page.getByText("Add to calendar")).toBeVisible();
    await expect(page.getByText("Book again")).toBeVisible();
    await expect(page.getByText("Request cancellation")).toBeVisible();
  });

  test("the whole URL is under 45 characters — the point of #741", async ({ page }) => {
    // The acceptance criterion, asserted against the URL a customer actually receives rather
    // than against the code in isolation. The origin here is the test server's, so this checks
    // the PATH is short; the 43-char production figure is pinned in booking-code.test.ts.
    await page.goto(manageUrl());
    const path = new URL(page.url()).pathname;
    expect(path).toBe(`/b/${CODE}`);
    expect(path.length).toBeLessThanOrEqual(20);
    expect(path).not.toContain("?");
  });

  test("the balance row states an obligation, never an automatic charge (#617)", async ({ page }) => {
    await page.goto(manageUrl());

    // The seed pays nothing, so the balance row renders. Nothing in Muster collects it —
    // #712 is the unbuilt auto-collect — so the label must not promise that it will.
    await expect(page.getByText(/Balance · due before your trip/)).toBeVisible();
    await expect(page.getByText(/charged before your trip/)).toHaveCount(0);
  });

  test("the cancellation terms sit with the cancel action (#619)", async ({ page }) => {
    await page.goto(manageUrl());

    // A customer clicking "Request cancellation" should read the terms in the same place,
    // not have to go back to the checkout they already left.
    const terms = page.getByTestId("cancellation-terms");
    await expect(terms).toBeVisible();
    await expect(terms).toContainText(
      "Cancel 14 days or more before your cruise for a refund minus a $50 cancellation fee.",
    );
    await expect(terms).toContainText("no-shows");
    // No sentence selling insurance a booked customer can no longer buy (operator, 2026-10-13).
    await expect(terms).not.toContainText("insurance");
  });

  test("an unknown code shows a generic invalid-link state, not the booking", async ({ page }) => {
    // Well-formed but not a real code: the page must not confirm that a booking exists.
    await page.goto("/b/ZZZZZZZZZZZZZZ");
    await expect(page.getByText("This booking link isn’t valid")).toBeVisible();
    await expect(page.getByText("Marcus Webb")).toHaveCount(0); // never leaks the booking
  });

  test("a REVOKED code says the link was replaced — a different fact (#741)", async ({ page }) => {
    // The state that only exists because codes are stored. Whoever holds this code already knew
    // the booking existed, so telling them it was replaced leaks nothing — and it is the only
    // way they learn to ask for a new link instead of assuming their booking is gone.
    await page.goto(manageUrl(REVOKED));
    await expect(page.getByText("This booking link was replaced")).toBeVisible();
    await expect(page.getByText(/we’ll send you a new one/)).toBeVisible();
    await expect(page.getByText("Marcus Webb")).toHaveCount(0); // still no booking detail
  });

  test("a malformed code never reaches the booking either", async ({ page }) => {
    await page.goto("/b/not-a-code");
    await expect(page.getByText("This booking link isn’t valid")).toBeVisible();
  });

  test("Add to calendar downloads a tz-aware .ics", async ({ request }) => {
    const res = await request.get(`/b/${CODE}/calendar`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("SUMMARY:Reservation Demo Cruise");
    expect(body).toContain("DTSTART;TZID=");
  });

  test("the calendar route refuses a revoked code", async ({ request }) => {
    // Same guard as the page — a dead credential must not still hand out the trip details in a
    // format the page won't render.
    const res = await request.get(`/b/${REVOKED}/calendar`);
    expect(res.status()).toBe(404);
  });

  test.describe("Waivers (18.10, issue #1124)", () => {
    const WAIVER = {
      id: "wt-manage",
      version: "brewboat-2026-v1",
      body: "I accept the risks.",
      effectiveFrom: "2026-01-01T05:00:00.000Z",
    };
    const waivers = (page: Page) => page.getByRole("region", { name: "Waivers" });

    test("Sign the waiver opens the trip's signing page; See who's signed opens the party page", async ({ page }) => {
      await plantWaiverTemplate(WAIVER);
      await page.goto(manageUrl());

      await expect(waivers(page)).toBeVisible();
      await expect(waivers(page).getByText("Everyone aboard signs before the trip.")).toBeVisible();
      const sign = waivers(page).getByRole("link", { name: /Sign the waiver/ });
      await expect(sign).toHaveAttribute("href", /^\/w\/[0-9A-Z]{8}$/);
      await expect(waivers(page).getByRole("link", { name: /See who’s signed/ })).toHaveAttribute(
        "href",
        `/b/${CODE}/party`,
      );

      await sign.click();
      await expect(page.getByText("Your details")).toBeVisible();
    });

    test("no waiver in effect ⇒ no Waivers section — nobody could sign", async ({ page }) => {
      await page.goto(manageUrl());
      await expect(page.getByText("Book again")).toBeVisible();
      await expect(waivers(page)).toHaveCount(0);
    });

    test("a cancelled booking has no Waivers section", async ({ page }) => {
      await plantWaiverTemplate(WAIVER);
      await cancelReservationRow(RID);
      await page.goto(manageUrl());
      await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
      await expect(waivers(page)).toHaveCount(0);
    });

    test("once the trip's day is over, only See who's signed remains", async ({ page }) => {
      await plantWaiverTemplate(WAIVER);
      await moveEventDate(await eventIdOfReservation(RID), "2026-01-02");
      await page.goto(manageUrl());
      await expect(waivers(page).getByRole("link", { name: /See who’s signed/ })).toBeVisible();
      await expect(waivers(page).getByRole("link", { name: /Sign the waiver/ })).toHaveCount(0);
      await expect(waivers(page).getByText("Everyone aboard signs before the trip.")).toHaveCount(0);
    });
  });

  /**
   * "Your other trips" (16.9 AC16, issue #1074). The seed books Marcus Webb twice on one phone,
   * so his first booking's page lists the second — which has its own live code (the seed mints
   * one for every booking). Customers merge on an unverified phone (issue #1213), so a link here
   * would hand a stranger a manage page that can now cancel.
   */
  const OTHER_CODE = demoBookingCode(demoReservationId(BOOKED_3.date, BOOKED_3.time));
  const otherTrips = (page: Page) =>
    page.getByRole("heading", { name: "Your other trips", exact: true }).locator("xpath=..");

  test("AC16: Your other trips lists the other booking as a plain row, never a link", async ({ page }) => {
    await page.goto(manageUrl());

    const section = otherTrips(page);
    await expect(section).toBeVisible();
    await expect(section).toContainText(`${formatShortDay(BOOKED_3.date)} · ${formatClock(BOOKED_3.time)}`);
    await expect(section).toContainText("Trip");
    await expect(section.locator("a")).toHaveCount(0);
    await expect(section).not.toContainText("›");
  });

  test("AC16: no other booking's manage code reaches the page", async ({ request }) => {
    // The raw response, not the DOM: an href dropped from the markup but still carried in the
    // server-component payload would put the code in front of whoever holds this link.
    const res = await request.get(manageUrl());
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("Your other trips");
    expect(html).not.toContain(OTHER_CODE);
  });

  test("requesting a cancellation acknowledges the out-of-band request", async ({ page }) => {
    await page.goto(manageUrl());
    await page.getByText("Request cancellation").click(); // opens the <details>
    await page.getByRole("button", { name: "Send request" }).last().click();
    await page.waitForURL(/requested=cancel/);
    await expect(page.getByText(/sent your cancellation request/)).toBeVisible();
  });
});

/**
 * Self-service cancellation (16.9, issue #1074). The seeds, in the order the issue's hand pass runs
 * them: `self-cancel` books Rhea Tallis 20 days out (Cancel offered, the $50 fee), Gil Moreau 5 days
 * out (inside the window — the request form), and Pell Ostrander 20 days out and then cancelled by
 * the customer, with a real `issued` refund on `FakePaymentPort`. `insurance` books Quint Harlan,
 * paid and insured, 5 days out.
 *
 * **No case here presses Cancel booking.** The server loads `.env.local`, so on a box with Stripe
 * test keys the press reaches test-mode Stripe and the outcome depends on the machine. The refund
 * leg is unit-tested on `FakePaymentPort` in `src/reservations/customer-cancel.test.ts`.
 */
test.describe("self-service cancel on /b/<code> (16.9)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation", "insurance", "self-cancel");
  });

  const FIGURE = /\$[\d,]+\.\d{2}/;
  const CONFIRM_LINE = "This can’t be undone.";
  const cancelLink = (page: Page) => page.getByRole("link", { name: /Cancel booking/ });
  /** The control for every "not offered" case: the same seed's 20-day booking IS offered. */
  async function expectRheaOffered(page: Page): Promise<void> {
    await page.goto(`/b/${await bookingCodeFor("Rhea Tallis")}`);
    await expect(cancelLink(page)).toBeVisible();
  }

  test("AC13: the confirm for a 20-day uninsured booking reads the fee lines", async ({ page }) => {
    const code = await bookingCodeFor("Rhea Tallis");
    await page.goto(`/b/${code}?cancel=1`);

    await expect(page.getByText(`Cancel your 3:30 PM trip on ${formatShortDay(addDays(TODAY, 20))}?`)).toBeVisible();
    await expect(page.getByText(/You’ll get \$[\d,]+\.\d{2} back to your card\./)).toBeVisible();
    await expect(page.getByText("That’s what you paid, less the $50 cancellation fee.")).toBeVisible();
    await expect(page.getByText(CONFIRM_LINE)).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel booking" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Keep it" })).toBeVisible();
  });

  test("AC13: the confirm for an insured booking reads the insurance lines", async ({ page }) => {
    const code = await bookingCodeFor("Quint Harlan");
    await page.goto(`/b/${code}?cancel=1`);

    await expect(page.getByText(`Cancel your 5:30 PM trip on ${formatShortDay(addDays(TODAY, 5))}?`)).toBeVisible();
    await expect(page.getByText(/You’ll get \$[\d,]+\.\d{2} back to your card\./)).toBeVisible();
    await expect(page.getByText("That’s what you paid, less the $30 cancellation insurance.")).toBeVisible();
    await expect(page.getByText("less the $50 cancellation fee")).toHaveCount(0);
  });

  test("AC13: Keep it changes nothing", async ({ page }) => {
    const code = await bookingCodeFor("Rhea Tallis");
    await page.goto(`/b/${code}?cancel=1`);
    await expect(page.getByText(CONFIRM_LINE)).toBeVisible();

    await page.getByRole("link", { name: "Keep it" }).click();
    await page.waitForURL((url) => url.pathname === `/b/${code}` && url.search === "");

    await expect(page.getByText(CONFIRM_LINE)).toHaveCount(0);
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(cancelLink(page)).toBeVisible();
  });

  test("AC13: a booking inside its window shows the request form and no Cancel action", async ({ page }) => {
    await expectRheaOffered(page);
    const code = await bookingCodeFor("Gil Moreau");
    await page.goto(`/b/${code}`);

    await expect(page.getByText("Request cancellation")).toBeVisible();
    await expect(cancelLink(page)).toHaveCount(0);
  });

  test("AC3: ?cancel=1 on a booking inside its window shows no confirm; the request form stays", async ({ page }) => {
    await expectRheaOffered(page);
    const code = await bookingCodeFor("Gil Moreau");
    await page.goto(`/b/${code}?cancel=1`);

    await expect(page.getByText("Request cancellation")).toBeVisible();
    await expect(page.getByText(CONFIRM_LINE)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel booking" })).toHaveCount(0);
  });

  test("AC13: a departed booking shows no Cancel action", async ({ page }) => {
    await expectRheaOffered(page);
    const code = await bookingCodeFor("Rhea Tallis");
    await moveEventDate(await eventIdOfReservation(await reservationIdFor("Rhea Tallis")), "2026-01-02");

    await page.goto(`/b/${code}`);
    await expect(page.getByText("Your booking", { exact: true })).toBeVisible();
    await expect(cancelLink(page)).toHaveCount(0);
    await page.goto(`/b/${code}?cancel=1`);
    await expect(page.getByText(CONFIRM_LINE)).toHaveCount(0);
  });

  test("AC13: an already-cancelled booking at ?cancelled=1&refund=issued shows the issued notice with its trail figure", async ({
    page,
  }) => {
    const code = await bookingCodeFor("Pell Ostrander");
    await page.goto(`/b/${code}?cancelled=1&refund=issued`);

    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    const notice = page.getByText(/Your booking is cancelled\.\s*\$[\d,]+\.\d{2} is on its way back to your card\./);
    await expect(notice).toBeVisible();
    // The figure is the trail row's — the one the refund actually took, which the Refunded row shows.
    const figure = FIGURE.exec((await notice.textContent()) ?? "")?.[0];
    expect(figure).toBeDefined();
    await expect(page.getByText(`−${figure}`, { exact: true })).toBeVisible();
  });

  test("AC8: which notice shows comes from the trail — a refunded booking at ?cancelled=1&refund=failed shows the issued notice", async ({
    page,
  }) => {
    // Pell Ostrander's refund went through (no refund_failed row), so a stale or crafted
    // `refund=failed` changes nothing.
    const code = await bookingCodeFor("Pell Ostrander");
    await page.goto(`/b/${code}?cancelled=1&refund=failed`);

    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    const notice = page.getByText(/Your booking is cancelled\.\s*\$[\d,]+\.\d{2} is on its way back to your card\./);
    await expect(notice).toBeVisible();
    await expect(page.getByText(/refund didn’t go through yet/)).toHaveCount(0);
    const figure = FIGURE.exec((await notice.textContent()) ?? "")?.[0];
    expect(figure).toBeDefined();
    await expect(page.getByText(`−${figure}`, { exact: true })).toBeVisible();
  });

  test("AC8: ?cancelled=1 alone says to show a notice — a refunded booking with no refund= shows the issued notice", async ({
    page,
  }) => {
    const code = await bookingCodeFor("Pell Ostrander");
    await page.goto(`/b/${code}?cancelled=1`);

    await expect(page.getByText(/Your booking is cancelled\.\s*\$[\d,]+\.\d{2} is on its way back to your card\./)).toBeVisible();
    await expect(page.getByText(/refund didn’t go through yet/)).toHaveCount(0);
  });

  test("AC10: with no customer cancelled row, ?cancelled=1 shows no notice — the URL carries no figure", async ({ page }) => {
    const code = await bookingCodeFor("Gil Moreau");
    await page.goto(`/b/${code}?cancelled=1&refund=issued&amount=99999`);

    await expect(page.getByText("Your booking", { exact: true })).toBeVisible();
    await expect(page.getByText(/is on its way back to your card/)).toHaveCount(0);
    await expect(page.getByText("$999.99")).toHaveCount(0);
  });

  test("AC6: cancel_changed re-opens the confirm under its notice", async ({ page }) => {
    const code = await bookingCodeFor("Rhea Tallis");
    await page.goto(`/b/${code}?cancel=1&error=cancel_changed`);

    await expect(page.getByText(/The refund changed since you opened this\./)).toBeVisible();
    await expect(page.getByText(/nothing has been cancelled/)).toBeVisible();
    await expect(page.getByText(CONFIRM_LINE)).toBeVisible();
  });

  test("AC6: cancel_closed renders the request form under its notice", async ({ page }) => {
    const code = await bookingCodeFor("Gil Moreau");
    await page.goto(`/b/${code}?error=cancel_closed`);

    await expect(page.getByText(/It’s too close to your trip to cancel online now\./)).toBeVisible();
    await expect(page.getByText("Request cancellation")).toBeVisible();
    await expect(cancelLink(page)).toHaveCount(0);
  });

  test("AC6: cancel_failed says nothing changed", async ({ page }) => {
    const code = await bookingCodeFor("Rhea Tallis");
    await page.goto(`/b/${code}?error=cancel_failed`);

    await expect(page.getByText(/Couldn’t cancel just now\./)).toBeVisible();
    await expect(page.getByText(/Nothing changed — try again in a moment\./)).toBeVisible();
  });
});
