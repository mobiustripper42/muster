/**
 * Flow 2 (#65): the In/Out tap. In confirms the seat (DEC-061 auto-confirm) → it
 * joins My shifts as a confirmed (clickable) shift and the ask card clears. Out
 * declines → the card clears with no new shift. Both assert the ask is *gone*
 * afterward (the tap landed).
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew ask — In / Out", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("In auto-confirms the seat → My shifts shows it as a confirmed shift", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByText("In or out?")).toBeVisible();

    await page.getByRole("button", { name: "In", exact: true }).click();

    // Auto-confirm (DEC-061): the "In" locks the seat immediately — no operator
    // confirm step — so `shift-ask` joins My shifts as a confirmed, clickable row,
    // never an "awaiting confirmation" placeholder.
    await expect(page.locator('a[href="/crew/shift/shift-ask"]')).toBeVisible();
    await expect(page.getByText("Awaiting confirmation")).toHaveCount(0);
    // …and the ask is answered, so the card is gone.
    await expect(page.getByText("In or out?")).toHaveCount(0);
  });

  test("only the tapped button spins; both disable while in flight (DEC-089)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByText("In or out?")).toBeVisible();

    // Delay the respondToAsk server-action POST so the transient pending frame is
    // observable (it clears on the redirect the action fires).
    await page.route("**/crew", async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.continue();
    });

    const inBtn = page.getByRole("button", { name: "In", exact: true });
    const outBtn = page.getByRole("button", { name: "Out", exact: true });
    await inBtn.click();

    // In flight: only the tapped button (In) is busy, but BOTH disable — the
    // shared-form double-tap guard (useFormStatus is form-wide; spinsWhen scopes
    // only the spinner). opacity-0 (not visibility:hidden) keeps the name "In", so
    // the locator still resolves while spinning.
    await expect(inBtn).toHaveAttribute("aria-busy", "true");
    await expect(inBtn).toBeDisabled();
    await expect(outBtn).toBeDisabled();
    await expect(outBtn).toHaveAttribute("aria-busy", "false");
  });

  test("Out declines → the ask card clears, no new shift", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByText("In or out?")).toBeVisible();

    await page.getByRole("button", { name: "Out", exact: true }).click();

    await expect(page.getByText("In or out?")).toHaveCount(0);
    await expect(page.getByText("Awaiting confirmation")).toHaveCount(0);
  });
});
