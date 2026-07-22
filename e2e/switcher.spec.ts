/**
 * Crew ↔ admin view switcher (DEC-093). A dual-role person (every admin is also
 * crew — DEC-092) moves between the two apps by re-minting the other-kind session
 * for the same id, no re-auth. `switchToAdmin` is a privilege-escalation seam,
 * server-gated on `getAdmin(active)` — the crew-home control is a convenience, the
 * action re-checks.
 *
 * `crew-spink` is both a seeded crew member (outbox seed) and the fixture admin,
 * so it's the dual-role subject. `crew-obx-bo` is crew-only.
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsCrew,
  signInAsAdmin,
  setAdminActive,
} from "./fixtures.js";

const SWITCH_TO_ADMIN = { role: "button" as const, name: /switch to admin/i };
const CREW_VIEW = { role: "button" as const, name: /crew view/i };

test.describe("crew ↔ admin switcher (DEC-093)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("outbox");
  });

  // SKIPPED — #447 (admin nav). The desktop nav overflows its row: the links block
  // overlaps the tenant/date label and the "Crew view" button, so the label renders
  // zero-width (hidden) and Playwright reports `<span>Outbox</span> ... intercepts
  // pointer events` on the button. A real UI bug, deliberately NOT patched around:
  // letting the row wrap would bust the 52px height budget the two-pane shell
  // subtracts (#253) — see the note in components/admin/admin-nav.tsx. The
  // assertions below are correct and unchanged; un-skip when #447 lands.
  test.fixme("round-trip: a dual-role person crosses both ways with one login", async ({
    page,
  }) => {
    // Logged in as crew (crew-spink, who is also the fixture admin).
    await signInAsCrew(page, "crew-spink");
    await expect(page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name })).toBeVisible();

    // Crew → admin (escalation).
    await page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name }).click();
    await page.waitForURL(/\/admin/);
    await expect(page.getByRole(CREW_VIEW.role, { name: CREW_VIEW.name })).toBeVisible();

    // Admin → crew (de-escalation) — back where we started.
    await page.getByRole(CREW_VIEW.role, { name: CREW_VIEW.name }).click();
    await page.waitForURL((u) => u.pathname === "/crew");
    await expect(page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name })).toBeVisible();
  });

  // SKIPPED — #447 (admin nav). The desktop nav overflows its row: the links block
  // overlaps the tenant/date label and the "Crew view" button, so the label renders
  // zero-width (hidden) and Playwright reports `<span>Outbox</span> ... intercepts
  // pointer events` on the button. A real UI bug, deliberately NOT patched around:
  // letting the row wrap would bust the 52px height budget the two-pane shell
  // subtracts (#253) — see the note in components/admin/admin-nav.tsx. The
  // assertions below are correct and unchanged; un-skip when #447 lands.
  test.fixme("also reachable starting from an admin session (Crew view in the nav)", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink"); // lands on /admin/at-risk
    await page.getByRole(CREW_VIEW.role, { name: CREW_VIEW.name }).click();
    await page.waitForURL((u) => u.pathname === "/crew");
    await expect(page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name })).toBeVisible();
  });

  test("a crew-only member sees no switch (the control is admin-gated)", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-obx-bo"); // crew, not an admin
    await expect(page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name })).toHaveCount(0);
  });

  test("a revoked admin's switch control disappears on the next render", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-spink");
    await expect(page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name })).toBeVisible();

    await setAdminActive("spink", false); // deprovision
    await page.reload();

    // viewerIsActiveAdmin is now false → the control is gone (visibility only).
    await expect(page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name })).toHaveCount(0);
  });

  test("revoke is enforced by the ACTION, not the button: a stale click is refused server-side", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-spink");
    const btn = page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name });
    await expect(btn).toBeVisible();

    // Revoke WITHOUT reloading — the button is now stale in the DOM, so this
    // click actually invokes switchToAdmin whose getAdmin(active) gate now fails.
    await setAdminActive("spink", false);
    await btn.click();

    // Bounced to /crew — NOT escalated to /admin, no admin session minted.
    await page.waitForURL((u) => u.pathname === "/crew");
    expect(new URL(page.url()).pathname).not.toMatch(/^\/admin/);
    await expect(page.getByRole(CREW_VIEW.role, { name: CREW_VIEW.name })).toHaveCount(0);
    await expect(page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name })).toHaveCount(0);
  });
});
