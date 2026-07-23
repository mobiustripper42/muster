/**
 * 7.0a (DEC-081) — crew self-serve front door: sign out, and the signed-out
 * email→code sign-in flow. The security-sensitive surface (an unauthenticated
 * endpoint + the no-enumeration property) gets the e2e attention.
 *
 * NOT covered here: the full code→session happy path. Only the code's HASH is
 * stored, so a black-box test can't read the minted code back. That round-trip
 * is covered at the unit level (src/auth/login-code.test.ts) and by a manual
 * eyeball (read the code from the dev-server log). Everything reachable without
 * the code is exercised below.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

const QUINT_EMAIL = "quint@brewboat.test";
const CODE_SENT = /a 6-digit code is on its way/i;

test.describe("crew self-serve sign-in (DEC-081)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("signed-out → the email sign-in form", async ({ page }) => {
    await page.goto("/crew");
    await expect(page.getByLabel(/sign in with your crew email/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /email me a code/i })).toBeVisible();
  });

  test("a known email advances to the code-entry screen", async ({ page }) => {
    await page.goto("/crew");
    await page.getByLabel(/sign in with your crew email/i).fill(QUINT_EMAIL);
    await page.getByRole("button", { name: /email me a code/i }).click();
    await expect(page.getByText(CODE_SENT)).toBeVisible();
    await expect(page.getByLabel(/enter your code/i)).toBeVisible();
  });

  test("an unknown email yields the IDENTICAL screen (no enumeration)", async ({
    page,
  }) => {
    await page.goto("/crew");
    await page.getByLabel(/sign in with your crew email/i).fill("nobody@nowhere.test");
    await page.getByRole("button", { name: /email me a code/i }).click();
    // Same code-sent copy + same code input as a real match — nothing leaks.
    await expect(page.getByText(CODE_SENT)).toBeVisible();
    await expect(page.getByLabel(/enter your code/i)).toBeVisible();
  });

  // Un-skipped (#504). This read back "" for a while, and the suspicion was that
  // `next start` served the action and the echo route from different workers so the
  // globalThis Map wasn't shared. It doesn't: an instrumented probe showed the mint
  // and the read landing in ONE process (server log `[login-code] → …: 240431`, echo
  // returns the same six digits), and the test then passed fresh, multi-spec, and in
  // the full suite. The likely culprit was a stale reused server on :3100 — see the
  // stale-build note in auth-delivery.ts.
  test("the full round-trip: email → real code → signed in", async ({ page }) => {
    await page.goto("/crew");
    await page.getByLabel(/sign in with your crew email/i).fill(QUINT_EMAIL);
    await page.getByRole("button", { name: /email me a code/i }).click();
    await expect(page.getByText(CODE_SENT)).toBeVisible();

    // Read the delivered code from the dev-only echo (hash-only store; same
    // affordance as dev-link). Real delivery is email in 7.0b.
    const res = await page.request.get(
      `/crew/dev-code?email=${encodeURIComponent(QUINT_EMAIL)}`,
    );
    const code = (await res.text()).trim();
    expect(code).toMatch(/^\d{6}$/);

    await page.getByLabel(/enter your code/i).fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Landed in the app as Quint, session minted.
    await expect(page).toHaveURL(/\/crew(\/|\?|$)/);
    await expect(page.getByRole("heading", { name: "Quint" })).toBeVisible();
  });

  test("a wrong code is rejected and keeps you on the code screen", async ({
    page,
  }) => {
    await page.goto("/crew");
    await page.getByLabel(/sign in with your crew email/i).fill(QUINT_EMAIL);
    await page.getByRole("button", { name: /email me a code/i }).click();
    await page.getByLabel(/enter your code/i).fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/check it and try again/i)).toBeVisible();
    await expect(page.getByLabel(/enter your code/i)).toBeVisible();
  });

  test("a signed-in crew member can sign out", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByRole("heading", { name: "Quint" })).toBeVisible();
    await page.getByRole("button", { name: /sign out/i }).click();
    // Back to the signed-out front door — the app (their name) is gone.
    await expect(page.getByLabel(/sign in with your crew email/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quint" })).toHaveCount(0);
  });
});
