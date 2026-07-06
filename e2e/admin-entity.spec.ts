/**
 * Admin entity + per-person revoke (Phase 10.2, DEC-092). Admin is now a real,
 * individually-revocable identity keyed by crew id. Deprovisioning ONE admin flips
 * `active=false`; their next request dies at readSubject's admin active-check, while
 * every OTHER admin's stateless session is untouched — the whole point vs rotating
 * the shared SESSION_SECRET (which logs everyone out at once).
 *
 * The seeded operator admin is `spink` (fixtures) — what signInAsAdmin resolves via
 * the dev-link handle→id lookup. "You're signed out … tap an operator magic link"
 * is the SignedOut notice unique to a null subject, so it's the discriminator.
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsAdmin,
  seedExtraAdmin,
  setAdminActive,
} from "./fixtures.js";

const SIGNED_OUT = /tap an operator magic link/i;

test.describe("admin entity + per-person revoke (DEC-092)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("a seeded admin signs in and reaches the cockpit", async ({ page }) => {
    await signInAsAdmin(page, "spink"); // lands on /admin/at-risk
    await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);
    // The admin nav frame only renders for an admin subject (layout gate).
    await expect(page.getByRole("link", { name: "Shifts" })).toBeVisible();
  });

  test("deprovisioning an admin kills their session on the next request", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);

    // Revoke this one admin — the cookie is unchanged, but the identity behind it
    // is now inactive.
    await setAdminActive("spink", false);
    await page.reload();

    // readSubject's admin active-check resolves the same cookie to null.
    await expect(page.getByText(SIGNED_OUT)).toBeVisible();
    await expect(page.getByRole("link", { name: "Shifts" })).toHaveCount(0);
  });

  test("revoke is per-person: a second admin survives the first's revoke", async ({
    browser,
  }) => {
    await seedExtraAdmin({
      id: "crew-brendan-mcgovern",
      handle: "brendan",
      name: "Brendan",
    });
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    try {
      await signInAsAdmin(pageA, "spink");
      await signInAsAdmin(pageB, "brendan");

      await setAdminActive("spink", false); // revoke ONLY spink

      await pageA.reload();
      await pageB.reload();
      await expect(pageA.getByText(SIGNED_OUT)).toBeVisible(); // revoked
      await expect(pageB.getByText(SIGNED_OUT)).toHaveCount(0); // survives
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
