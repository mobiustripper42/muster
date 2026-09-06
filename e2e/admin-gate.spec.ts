/**
 * Admin-surface gate fallback (#352). Every admin page short-circuits to
 * `<AdminSignedOut>` when the caller isn't an admin. The old fallback always said
 * "tap a magic link" — a dead end for the operator's real case: he's signed in AS
 * CREW (every admin is also crew, DEC-092/093) and just needs to switch up. The
 * fallback now branches on WHO the caller is:
 *   - crew who is an active admin → a "Switch to admin" control (the operator's case)
 *   - crew, not an admin        → redirect straight to their crew home (no dead-end)
 *   - no session                → "sign in" (the crew-code front door at /crew)
 *
 * `crew-eric-stoffer` is the dual-role subject (seeded crew + fixture admin); `crew-obx-bo`
 * is crew-only. /admin/shifts stands in for "any admin surface" — the gate is shared.
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsCrew,
} from "./fixtures.js";

const SWITCH_TO_ADMIN = { role: "button" as const, name: /switch to admin/i };
const ADMIN_SURFACE = "/admin/shifts";

test.describe("admin-gate fallback (#352)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("a crew-signed-in admin hitting an admin surface gets the switch-up, not a dead end", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-eric-stoffer"); // dual-role, holding a CREW session

    // Deep-link straight to an admin surface while signed in as crew.
    await page.goto(ADMIN_SURFACE);

    // Not a dead end: the gate offers the escalation.
    const switchBtn = page.getByRole(SWITCH_TO_ADMIN.role, {
      name: SWITCH_TO_ADMIN.name,
    });
    await expect(switchBtn).toBeVisible();
    await expect(page.getByText(/tap an operator magic link/i)).toHaveCount(0);

    // Clicking it escalates and lands in the admin app.
    await switchBtn.click();
    await page.waitForURL(/\/admin/);
  });

  test("a crew-only member is redirected to their crew home (no dead-end, no switch)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-obx-bo"); // crew, not an admin
    await page.goto(ADMIN_SURFACE);

    // Redirected straight home — never parked on a "not for you" admin screen.
    await page.waitForURL((u) => u.pathname === "/crew");
    await expect(
      page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name }),
    ).toHaveCount(0);
  });

  test("a signed-out visitor gets an actionable sign-in link", async ({
    page,
  }) => {
    // No sign-in — hit the admin surface cold.
    await page.goto(ADMIN_SURFACE);

    await expect(page.getByText(/you’re signed out/i)).toBeVisible();
    const signIn = page.getByRole("link", { name: /sign in/i });
    await expect(signIn).toBeVisible();
    await signIn.click();
    await page.waitForURL((u) => u.pathname === "/crew");
  });
});
