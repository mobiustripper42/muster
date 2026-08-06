/**
 * Customer "Your booking" manage page (task 12.6, #459) — the capability-URL landing (DEC-122).
 *
 * Uses the `reservation` seed: a booked trip at 13:30 on the 12th of next month (Marcus Webb,
 * fare $549, dates derived per #646) on the
 * live "Reservation Demo Cruise". The trip is in the FUTURE relative to the test clock, so the page
 * renders its UPCOMING state (the completed state's phase flip is unit-tested in manage-view.test).
 * Tokens are minted here with the same HMAC + secret the server verifies (`RESERVATION_LINK_SECRET`
 * pinned in playwright.config). Runs desktop + 375px.
 */
import { createHmac } from "node:crypto";
import { test, expect, resetAndSeed } from "./fixtures.js";
import { BOOKED, demoReservationId } from "./reservation-demo.js";

// Built with the seed's OWN id function — the dates inside it move now, and six specs
// hand-spelling `resv-demo-<date>-<time>` is how that drifts.
const RID = demoReservationId(BOOKED.date, BOOKED.time);
const SECRET = "e2e-reservation-link-secret";

/** Mirror `reservationLinkToken` (booking-link.ts): base64url(HMAC-SHA256(secret, tag:id)). */
function token(reservationId: string): string {
  return createHmac("sha256", SECRET).update(`reservation-link:v1:${reservationId}`).digest("base64url");
}

const manageUrl = (rid = RID) => `/reservations/manage?r=${encodeURIComponent(rid)}&t=${token(rid)}`;

test.describe("public /reservations/manage", () => {
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

    // Post-trip tip tiers (default 15/20/25% of the fare) + the manage actions.
    await expect(page.getByRole("button", { name: /Add a 20% tip/ })).toBeVisible();
    await expect(page.getByText("Add to calendar")).toBeVisible();
    await expect(page.getByText("Book again")).toBeVisible();
    await expect(page.getByText("Request cancellation")).toBeVisible();
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
    await expect(terms).not.toContainText(/insurance/i); // unsellable yet (#683)
  });

  test("a bad token shows a generic invalid-link state, not the booking", async ({ page }) => {
    await page.goto(`/reservations/manage?r=${encodeURIComponent(RID)}&t=not-a-real-token`);
    await expect(page.getByText("This booking link isn’t valid")).toBeVisible();
    await expect(page.getByText("Marcus Webb")).toHaveCount(0); // never leaks the booking
  });

  test("Add to calendar downloads a tz-aware .ics", async ({ request }) => {
    const res = await request.get(`/reservations/manage/calendar?r=${encodeURIComponent(RID)}&t=${token(RID)}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("SUMMARY:Reservation Demo Cruise");
    expect(body).toContain("DTSTART;TZID=");
  });

  test("requesting a cancellation acknowledges the out-of-band request", async ({ page }) => {
    await page.goto(manageUrl());
    await page.getByText("Request cancellation").click(); // opens the <details>
    await page.getByRole("button", { name: "Send request" }).last().click();
    await page.waitForURL(/requested=cancel/);
    await expect(page.getByText(/sent your cancellation request/)).toBeVisible();
  });
});
