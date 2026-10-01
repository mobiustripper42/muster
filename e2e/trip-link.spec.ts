/**
 * /w/<code> — trip links (Phase 18.3b, issue #1141). The rules are unit-tested in
 * `src/checkin/trip-link.test.ts`; here each state renders, at desktop and 375px, and the limit
 * answers before anything is looked up. The signing form behind an open link is 18.4's.
 */
import { test, expect, exhaustRateLimit, plantTripLink, resetAndSeed } from "./fixtures.js";
import { TRIP_LINK_LIMIT } from "../src/checkin/trip-link.js";

test.describe("trip links /w/<code>", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew"); // vessel-hops
  });

  test("an upcoming trip opens with its day and time, and never names the boat", async ({ page }) => {
    await plantTripLink({ code: "K3F9QZ2M", date: "2030-06-01", time: "15:00" });
    // Typed back loosely, as someone reading it off a text would. No waiver is posted here, so
    // the open trip says so (18.4); the signing flow itself is `signing.spec.ts`.
    await page.goto("/w/k3f9-qz2m");
    await expect(page.getByRole("heading", { name: "Waivers aren’t open for this trip yet" })).toBeVisible();
    await expect(page.getByText("Sat, Jun 1 · 3:00 PM")).toBeVisible();
    await expect(page.getByText("Hops")).toHaveCount(0);
  });

  test("a trip that has sailed says so", async ({ page }) => {
    await plantTripLink({ code: "SA11ED00", date: "2026-01-10", time: "15:00" });
    await page.goto("/w/SA11ED00");
    await expect(page.getByRole("heading", { name: "This trip has already sailed" })).toBeVisible();
  });

  test("a cancelled trip says so", async ({ page }) => {
    await plantTripLink({ code: "CANCE11D", date: "2030-06-01", time: "17:00", status: "cancelled" });
    await page.goto("/w/CANCE11D");
    await expect(page.getByRole("heading", { name: "This trip was cancelled" })).toBeVisible();
  });

  test("a code nobody minted, or junk, finds nothing", async ({ page }) => {
    await page.goto("/w/ZZZZZZZZ");
    await expect(page.getByRole("heading", { name: "We can’t find that trip" })).toBeVisible();
    await page.goto("/w/not-a-code-at-all");
    await expect(page.getByRole("heading", { name: "We can’t find that trip" })).toBeVisible();
  });

  test("past the limit, a real code gets 'one moment', never 'can't find', and Try again stays on the link", async ({
    page,
  }) => {
    await plantTripLink({ code: "K3F9QZ2M", date: "2030-06-01", time: "15:00" });
    // Local runs have no Vercel in front, so the address is set by hand (fixtures § exhaustRateLimit).
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.88" });
    await exhaustRateLimit(TRIP_LINK_LIMIT, "203.0.113.88");

    await page.goto("/w/K3F9QZ2M");
    await expect(page.getByRole("heading", { name: "One moment" })).toBeVisible();
    await expect(page.getByText(/lots of people are signing from this connection/i)).toBeVisible();
    await expect(page.getByText(/can’t find/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/w/K3F9QZ2M");
  });
});
