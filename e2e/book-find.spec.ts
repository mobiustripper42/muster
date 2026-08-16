/**
 * "Lost your link?" recovery (12.7, issue #460) — the public `/b/find` surface.
 *
 * What this pins is the SURFACE, not the send: whether the route exists beside `/b/[code]`
 * without being swallowed by it, whether the response is identical on a hit and a miss, and
 * whether the three entry points actually point here. The send itself is unit-tested
 * (`recover-booking-link.test.ts`) because it depends on channel config that differs between a
 * dev box and CI — asserting it here would pass in one place and fail in the other.
 */
import { test, expect, resetAndSeed } from "./fixtures.js";
import { BOOKED, demoBookingCode, demoRevokedBookingCode, demoReservationId } from "./reservation-demo.js";

const RID = demoReservationId(BOOKED.date, BOOKED.time);
const CODE = demoBookingCode(RID);
const REVOKED = demoRevokedBookingCode(RID);

test.describe("public /b/find", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("the static route is not swallowed by /b/[code], and vice versa", async ({ page }) => {
    // Next resolves static segments before dynamic ones, so `find` never reaches the code route.
    // Both directions are pinned because the failure is silent either way: `/b/find` rendering
    // "this link isn't valid", or a real code rendering the recovery form.
    await page.goto("/b/find");
    await expect(page.getByRole("heading", { name: "Lost your link?" })).toBeVisible();

    await page.goto(`/b/${CODE}`);
    await expect(page.getByText("Your booking", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lost your link?" })).toHaveCount(0);
  });

  test("a matching request and a non-matching one are indistinguishable", async ({ page }) => {
    // The security property. A form that says "no booking with that email" tells a stranger who
    // has booked with this operator; one that varies its wording does it more quietly. Both
    // submissions must land on byte-identical copy.
    await page.goto("/b/find");
    await page.getByLabel("Email or phone").fill("216-555-0148"); // the seeded booking's phone
    await page.getByLabel("Last name").fill("Webb");
    await page.getByRole("button", { name: "Send me my link" }).click();
    await page.waitForURL(/sent=1/);
    const hit = await page.getByRole("main").innerText();

    await page.goto("/b/find");
    await page.getByLabel("Email or phone").fill("nobody@example.com");
    await page.getByLabel("Last name").fill("Nobody");
    await page.getByRole("button", { name: "Send me my link" }).click();
    await page.waitForURL(/sent=1/);
    const miss = await page.getByRole("main").innerText();

    expect(miss).toBe(hit);
    expect(hit).toContain("if we find a booking that matches");
    // Never states that a booking exists, or that one doesn't.
    expect(hit).not.toMatch(/we found|no booking|not found|doesn’t exist/i);
  });

  test("the page never renders a booking link", async ({ page }) => {
    // The link goes to the contact on file and NOWHERE else — typing someone's phone number must
    // not print their credential on screen.
    await page.goto("/b/find");
    await page.getByLabel("Email or phone").fill("216-555-0148");
    await page.getByLabel("Last name").fill("Webb");
    await page.getByRole("button", { name: "Send me my link" }).click();
    await page.waitForURL(/sent=1/);

    const body = await page.content();
    expect(body).not.toContain(CODE);
    expect(body).not.toMatch(/\/b\/[0-9A-Z]{14}/);
  });

  test("a revoked link offers a route back here", async ({ page }) => {
    // The dead end this closes: before #460 this page said "reply to your confirmation text",
    // which is not something a customer can act on at 11pm.
    await page.goto(`/b/${REVOKED}`);
    await expect(page.getByText("This booking link was replaced")).toBeVisible();
    await page.getByRole("link", { name: "Send me a new link" }).click();
    await expect(page.getByRole("heading", { name: "Lost your link?" })).toBeVisible();
  });

  test("an invalid link offers the same route", async ({ page }) => {
    await page.goto("/b/ZZZZZZZZZZZZZZ");
    await expect(page.getByText("This booking link isn’t valid")).toBeVisible();
    await page.getByRole("link", { name: "have your link sent again" }).click();
    await expect(page.getByRole("heading", { name: "Lost your link?" })).toBeVisible();
  });

  test("/book carries the entry point for someone who has no link at all", async ({ page }) => {
    // The commonest recovery case, and the one the other two entry points cannot serve: the
    // customer deleted the text, so they have nothing to click.
    await page.goto("/book");
    // The accessible name is both lines — "Already booked? Find my booking" — because the
    // question sits inside the link to make one 44px tap target. Matched loosely so a copy tweak
    // doesn't fail a test that is about the ROUTE existing.
    await page.getByRole("link", { name: /Find my booking/ }).click();
    await expect(page.getByRole("heading", { name: "Lost your link?" })).toBeVisible();
  });
});
