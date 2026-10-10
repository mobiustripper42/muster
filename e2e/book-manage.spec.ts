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
import {
  test,
  expect,
  cancelReservationRow,
  eventIdOfReservation,
  moveEventDate,
  plantWaiverTemplate,
  resetAndSeed,
} from "./fixtures.js";
import { BOOKED, demoBookingCode, demoRevokedBookingCode, demoReservationId } from "./reservation-demo.js";

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
    // An uninsured booking reads the published terms whole, the insurance sentence included (16.8).
    await expect(terms).toContainText("Optional cancellation insurance ($30) moves the 14 days to 72 hours.");
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

  test("requesting a cancellation acknowledges the out-of-band request", async ({ page }) => {
    await page.goto(manageUrl());
    await page.getByText("Request cancellation").click(); // opens the <details>
    await page.getByRole("button", { name: "Send request" }).last().click();
    await page.waitForURL(/requested=cancel/);
    await expect(page.getByText(/sent your cancellation request/)).toBeVisible();
  });
});
