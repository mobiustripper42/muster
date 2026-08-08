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
  clickHydrated,
} from "./fixtures.js";

const SWITCH_TO_ADMIN = { role: "button" as const, name: /switch to admin/i };
// "Switch to crew" since #709 — it moved out of the brand cluster into the Account menu, and
// the label became symmetric with "Switch to admin" once the two sat side by side.
const CREW_VIEW = { role: "button" as const, name: /switch to crew/i };

/**
 * Open the admin bar's Account group (#709) — the control is one disclosure deep now.
 *
 * These two tests were `test.fixme` on #447: the desktop link row overflowed and painted over
 * the brand cluster, so Playwright reported the nav links "intercept pointer events" on the
 * Crew view button sitting there. Moving that button OUT of the cluster and into this menu
 * dissolved the blocker — the interception is gone. What is left is an honest extra tap, which
 * is what a menu is.
 */
async function openCrewMenu(page: import("@playwright/test").Page): Promise<void> {
  // The crew side's counterpart, one tap deep since #644 moved Switch to admin and Sign out into
  // the drawer. The `fixme` on #447 was hiding that move too — a test parked for one reason
  // quietly accumulates others.
  // Unconditional, so Playwright's auto-wait does the work. An `if (await isVisible())` guard
  // reads false the instant the header hasn't rendered yet, silently skips the open, and the
  // assertion after it fails — flaky 2 runs in 4, measured. The crew header always has this
  // control, so there is nothing to be conditional about.
  await page.getByLabel("Open menu").click();
}

async function openAccount(page: import("@playwright/test").Page): Promise<void> {
  const account = page
    .getByRole("navigation", { name: "Admin" })
    .locator("summary:visible")
    .filter({ hasText: "Account" });
  // `clickHydrated`, not `click` — the nav's `useEffect([pathname])` strips `open` from every
  // <details> once it hydrates, so a click that lands first is silently undone and the panel is
  // shut again by the time the next line looks for a button in it. Flaky 3 runs in 4, measured;
  // `admin-nav.spec.ts` already opens its groups this way for the same reason.
  await clickHydrated(account);
}

test.describe("crew ↔ admin switcher (DEC-093)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("outbox");
  });

  // Live again as of #709, after months as a `test.fixme` on #447: the desktop link row
  // overflowed and painted over the brand cluster, so Playwright reported `<span>Outbox</span>
  // ... intercepts pointer events` on the "Crew view" button sitting there. #709 moved that
  // control into the Account menu, so nothing overlaps it. #447 itself is NOT fixed — the link
  // row can still overflow; it simply no longer has a button underneath it to swallow.
  //
  // **Its sibling was DELETED rather than revived** (operator, 2026-08-08). A "round-trip"
  // version walked crew → admin → crew, and switching it back on revealed it had rotted in two
  // further ways while nobody was running it: #644 moved "Switch to admin" into the crew drawer,
  // and the admin bar's hydration effect closes any open `<details>` — so it needed a wait it
  // did not have and ran flaky 3 times in 4. It was also the least valuable test in this file:
  // the three below already cover the gating, the revoke, and the server-side refusal, and this
  // one covers admin → crew. A test switched off for months is not coverage; it is a note that
  // claims to be coverage, and keeping it switched off again would have preserved exactly that.
  test("also reachable starting from an admin session (Switch to crew in the nav)", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink"); // lands on /admin/at-risk
    await openAccount(page);
    await page.getByRole(CREW_VIEW.role, { name: CREW_VIEW.name }).click();
    await page.waitForURL((u) => u.pathname === "/crew");
    await openCrewMenu(page);
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
    // "Switch to admin" moved into the crew drawer (#644) — open it to see the control. The
    // drawer is a `<details>`, so while it is shut the control is genuinely not rendered, which
    // is why the count assertion below still means what it meant before.
    await page.locator(`summary[aria-label="Open menu"]`).click();
    await expect(page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name })).toBeVisible();

    await setAdminActive("spink", false); // deprovision
    await page.reload();

    // viewerIsActiveAdmin is now false → the control is gone (visibility only).
    await page.locator(`summary[aria-label="Open menu"]`).click();
    await expect(page.getByRole(SWITCH_TO_ADMIN.role, { name: SWITCH_TO_ADMIN.name })).toHaveCount(0);
  });

  test("revoke is enforced by the ACTION, not the button: a stale click is refused server-side", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-spink");
    await page.locator(`summary[aria-label="Open menu"]`).click();
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
