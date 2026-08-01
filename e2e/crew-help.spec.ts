/**
 * Onboarding orientation (Phase 10.6): the ask card spells out that "Yes" commits
 * the whole day (it used to commit silently), and a public "How Muster works"
 * page (/crew/help) explains the app + add-to-home-screen to a newcomer, reachable
 * from the crew home and without a session.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew onboarding — orientation", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("the ask card states the Yes/No consequence (Yes = this shift)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByText("Yes or no?")).toBeVisible();
    await expect(page.getByText(/Yes = you.re on for this shift/)).toBeVisible();
  });

  test('"How Muster works" on the crew home opens the help page', async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.getByRole("link", { name: "How Muster works" }).click();
    await expect(page.getByRole("heading", { name: "How Muster works" })).toBeVisible();
    await expect(page.getByText(/Add to Home Screen/)).toBeVisible();
  });

  test("the help page is public — readable before sign-in", async ({ page }) => {
    await page.goto("/crew/help");
    await expect(page.getByRole("heading", { name: "How Muster works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Answering an ask" })).toBeVisible();
    // key first-timer surfaces are present
    await expect(
      page.getByRole("heading", { name: "Add Muster to your home screen" }),
    ).toBeVisible();
  });
});
