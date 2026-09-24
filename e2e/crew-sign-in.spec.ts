/**
 * 7.0a (DEC-081) — crew self-serve front door: sign out, and the signed-out
 * email→code sign-in flow. The security-sensitive surface (an unauthenticated
 * endpoint + the no-enumeration property) gets the e2e attention.
 *
 * The full code→session round-trip reads the code back from the dev-only
 * `/crew/dev-code` echo (only its hash is stored) — the same path every sign-in
 * in the suite now takes (`fixtures.ts` § Sign-in).
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsCrew,
  seedCrewMember,
  removeCrewRow,
} from "./fixtures.js";
import type { Page } from "@playwright/test";

const QUINT_EMAIL = "quint@bb.test";
const CODE_SENT = /a 6-digit code is on its way/i;

/** Sign a throwaway crew member in through the door, then delete their row (#936). */
async function holdStaleSession(page: Page): Promise<void> {
  await seedCrewMember({ id: "crew-stale", name: "Stale", email: "stale@bb.test" });
  await signInAsCrew(page, "crew-stale");
  await removeCrewRow("crew-stale");
}

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
  // the full suite. What DID cause the original empty reads was never pinned down —
  // it was gone before it could be caught. If this goes red again, start from the
  // unconfirmed candidate in auth-delivery.ts (a stale reused server on :3100).
  test("the full round-trip: email → real code → signed in", async ({ page }) => {
    await page.goto("/crew");
    await page.getByLabel(/sign in with your crew email/i).fill(QUINT_EMAIL);
    await page.getByRole("button", { name: /email me a code/i }).click();
    await expect(page.getByText(CODE_SENT)).toBeVisible();

    // Read the delivered code from the dev-only echo (hash-only store; same
    // affordance). Real delivery is email in 7.0b.
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

  /**
   * #936. A crew session whose crew row is gone — an operator removing someone
   * mid-session, or a `db:reset:dev` under a live cookie. `buildCrewAppView`
   * returns null (`crew-view.ts:163`, `if (!me) return null`) and the page falls
   * to its `!view` branch, which rendered `<SignedOut>` with `pendingEmail={null}`
   * hardcoded and no `stage` at all — so the code screen could never render and
   * there was no way back in short of clearing cookies.
   *
   * The setup is the scenario itself: a crew member signs in through the door, then their
   * row is removed. (It used to mint a magic link for an id that never existed; the door
   * rightly refuses to, so the suite now reaches the state the way production does.)
   */
  test("a STALE crew session still lets you sign in again (#936)", async ({ page }) => {
    await holdStaleSession(page);

    await page.goto("/crew");
    await page.getByLabel(/sign in with your crew email/i).fill(QUINT_EMAIL);
    await page.getByRole("button", { name: /email me a code/i }).click();

    // The bug: this reported the email form again, with `?stage=code` in the URL.
    await expect(page.getByText(CODE_SENT)).toBeVisible();
    await expect(page.getByLabel(/enter your code/i)).toBeVisible();

    // And the whole way through, so the stale session is genuinely replaced rather
    // than merely rendered past.
    const res = await page.request.get(
      `/crew/dev-code?email=${encodeURIComponent(QUINT_EMAIL)}`,
    );
    const code = (await res.text()).trim();
    expect(code).toMatch(/^\d{6}$/);
    await page.getByLabel(/enter your code/i).fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Quint" })).toBeVisible();
  });

  test("a stale crew session SAYS it is stale, rather than silently showing step one (#936)", async ({
    page,
  }) => {
    await holdStaleSession(page);
    await page.goto("/crew");
    // Before #936 this was the bare email form with nothing to explain it, which is
    // what made the loop read as a broken app rather than a signed-out one.
    await expect(page.getByText(/your session ended/i)).toBeVisible();
  });

  test("`?stage=code` with no pending email says the step expired (#936)", async ({
    page,
  }) => {
    // Reachable by a bookmark, a back button, or simply waiting out the 600s cookie.
    // It used to render step one with no indication anything had lapsed.
    await page.goto("/crew?stage=code");
    await expect(page.getByText(/that sign-in step expired/i)).toBeVisible();
    await expect(page.getByLabel(/sign in with your crew email/i)).toBeVisible();
  });

  test("`?auth=stale` cannot fake a session notice for a browser that never had one (#936)", async ({
    page,
  }) => {
    // `reason` is `sp.auth`, straight off the URL. Keying "Your session ended." on it
    // would let anyone render a claim about the visitor's own history. No information
    // leaks either way — it is the same copy for everyone — but the page should not
    // assert something it did not derive. Gated on `sessionEnded` instead, which only
    // the `!view` branch sets.
    //
    // HONEST NOTE: unlike the three above, this case was written AFTER its fix, from a
    // `@code-review` finding, and has never been observed failing.
    await page.goto("/crew?auth=stale");
    await expect(page.getByText(/your session ended/i)).toHaveCount(0);
    await expect(page.getByLabel(/sign in with your crew email/i)).toBeVisible();
  });

  // Every text's link is plain since issue #1030 (DEC-181), so a signed-out crew member tapping
  // one must meet the code door. These pages used to say "Tap the link your operator sent" —
  // the link that no longer signs anyone in.
  for (const path of ["/crew/shift/shift-anything", "/crew/threads", "/crew/threads/thr-anything"]) {
    test(`signed out at ${path} → the code door, not a dead end`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByLabel(/sign in with your crew email/i)).toBeVisible();
    });
  }

  test("a signed-in crew member can sign out", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await expect(page.getByRole("heading", { name: "Quint" })).toBeVisible();
    // Sign out moved into the drawer (#644). It is pinned to the bottom, away from the
    // destinations — DEC-081 is about shared phones, so it has to stay findable, not just exist.
    await page.locator(`summary[aria-label="Open menu"]`).click();
    await page.getByRole("button", { name: /sign out/i }).click();
    // Back to the signed-out front door — the app (their name) is gone.
    await expect(page.getByLabel(/sign in with your crew email/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quint" })).toHaveCount(0);
  });
});
