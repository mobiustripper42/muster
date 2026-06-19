/**
 * Flow 1 + 6 (#65): dev-link → sign-in → the crew home renders its four pieces
 * (ask, my-shifts, standing, credential nudge). This is the foundation every
 * other crew flow stands on, and the credential-line copy (#57) that manual
 * eyeballing kept re-checking by hand.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew sign-in + render", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("sign-in lands on /crew with ask, my-shifts, standing, credential nudge", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");

    // Identity + own standing (§2.6.2) — name is the heading; the standing line
    // is always rendered (its copy varies, so assert presence via aria-label).
    await expect(page.getByRole("heading", { name: "Quint" })).toBeVisible();
    await expect(page.locator('p[aria-label^="Your standing:"]')).toBeVisible();

    // The open ask (§2.6.1) with its In/Out polarity.
    await expect(page.getByText("In or out?")).toBeVisible();
    await expect(page.getByRole("button", { name: "In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Out" })).toBeVisible();

    // My shifts section.
    await expect(page.getByRole("heading", { name: "My shifts" })).toBeVisible();

    // Credential nudge (#57) — assert the stable copy suffix, not the date.
    await expect(
      page.getByText(/renew it to keep getting asked for shifts/),
    ).toBeVisible();
  });

  test("no session → the signed-out state, not the app", async ({ page }) => {
    await page.goto("/crew");
    await expect(page.getByText(/signed out/i)).toBeVisible();
    await expect(page.getByText("In or out?")).toHaveCount(0);
  });
});
