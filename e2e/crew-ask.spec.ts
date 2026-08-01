/**
 * Flow 2 (#65): the Yes/No tap. Yes confirms the seat (DEC-061 auto-confirm) → it
 * joins My shifts as a confirmed (clickable) shift and the ask card clears. No
 * declines → the card clears with no new shift. Both assert the ask is *gone*
 * afterward (the tap landed).
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew ask — Yes / No", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("Yes auto-confirms the seat → My shifts shows it as a confirmed shift", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByText("Yes or no?")).toBeVisible();

    await page.getByRole("button", { name: "Yes", exact: true }).click();

    // Auto-confirm (DEC-061): the "Yes" locks the seat immediately — no operator
    // confirm step — so `shift-ask` joins My shifts as a confirmed, clickable row,
    // never an "awaiting confirmation" placeholder.
    await expect(page.locator('a[href="/crew/shift/shift-ask"]')).toBeVisible();
    await expect(page.getByText("Awaiting confirmation")).toHaveCount(0);
    // …and the ask is answered, so the card is gone.
    await expect(page.getByText("Yes or no?")).toHaveCount(0);
  });

  test("only the tapped button spins; both disable while in flight (DEC-089)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByText("Yes or no?")).toBeVisible();

    // Delay the respondToAsk server-action POST so the transient pending frame is
    // observable (it clears on the redirect the action fires).
    await page.route("**/crew", async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.continue();
    });

    const yesBtn = page.getByRole("button", { name: "Yes", exact: true });
    const noBtn = page.getByRole("button", { name: "No", exact: true });
    await yesBtn.click();

    // In flight: only the tapped button (Yes) is busy, but BOTH disable — the
    // shared-form double-tap guard (useFormStatus is form-wide; each button scopes
    // its own spinner by name/value against the pending FormData). opacity-0 (not
    // visibility:hidden) keeps the name "Yes", so the locator still resolves spinning.
    await expect(yesBtn).toHaveAttribute("aria-busy", "true");
    await expect(yesBtn).toBeDisabled();
    await expect(noBtn).toBeDisabled();
    await expect(noBtn).toHaveAttribute("aria-busy", "false");
  });

  test("No declines → the ask card clears, no new shift", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByText("Yes or no?")).toBeVisible();

    await page.getByRole("button", { name: "No", exact: true }).click();

    await expect(page.getByText("Yes or no?")).toHaveCount(0);
    await expect(page.getByText("Awaiting confirmation")).toHaveCount(0);
  });
});
