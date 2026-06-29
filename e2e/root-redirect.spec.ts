/**
 * #97 — the bare base URL is session-aware: a crew bookmark lands on My Shifts,
 * an operator on the admin hub, and a signed-out visitor on the sign-in prompt.
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsCrew,
  signInAsAdmin,
} from "./fixtures.js";

test.describe("root redirect (#97)", () => {
  test("no session → the sign-in prompt", async ({ page }) => {
    // The root `/` is a thin session router with its own prompt (app/page.tsx);
    // the self-serve email form lives on /crew, not here (DEC-080 left root alone).
    await page.goto("/");
    await expect(page.getByText(/tap the link your operator sent/i)).toBeVisible();
  });

  test("signed-in crew → /crew", async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsCrew(page, "crew-quint");
    await page.goto("/");
    await expect(page).toHaveURL(/\/crew(\/|\?|$)/);
    await expect(page.getByRole("heading", { name: "Quint" })).toBeVisible();
  });

  test("signed-in operator → /admin", async ({ page }) => {
    await resetAndSeed();
    await signInAsAdmin(page, "spink");
    await page.goto("/");
    await expect(page).toHaveURL(/\/admin(\/|\?|$)/);
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  });
});
