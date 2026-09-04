/**
 * #97 — the bare base URL is session-aware: a crew bookmark lands on My Shifts,
 * an operator on the admin hub, and a signed-out visitor is routed to the /crew
 * sign-in form (root no longer dead-ends with its own prompt).
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsCrew,
  signInAsAdmin,
} from "./fixtures.js";

test.describe("root redirect (#97)", () => {
  test("no session → routed to the /crew sign-in form", async ({ page }) => {
    // Root is a thin session router; a signed-out visitor lands on /crew, which
    // owns the crew-code sign-in form (DEC-081) — no bare-root dead-end.
    await page.goto("/");
    await expect(page).toHaveURL(/\/crew(\/|\?|$)/);
    await expect(
      page.getByText(/sign in with your crew email/i),
    ).toBeVisible();
  });

  test("an unmatched /crew/* path is redirected to /crew, not a 404", async ({
    page,
  }) => {
    const res = await page.goto("/crew/definitely-not-a-real-page");
    // Landed on the crew home (no hard 404), and the final response is 200.
    await expect(page).toHaveURL((u) => u.pathname === "/crew");
    expect(res?.status()).toBe(200);
  });

  test("an unmatched /admin/* path is redirected to /admin, not a 404", async ({
    page,
  }) => {
    const res = await page.goto("/admin/definitely-not-a-real-page");
    // Bounces to /admin, which lands on the shifts board (#603 — the hub is gone); no hard 404.
    await expect(page).toHaveURL((u) => u.pathname === "/admin/shifts");
    expect(res?.status()).toBe(200);
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
    await signInAsAdmin(page, "eric");
    await page.goto("/");
    await expect(page).toHaveURL(/\/admin(\/|\?|$)/);
    // `/admin` lands on the shifts board now (#603 — the hub is gone), so the landing heading
    // is the board's, not "Admin".
    await expect(page.getByRole("heading", { name: "All shifts" })).toBeVisible();
  });
});
