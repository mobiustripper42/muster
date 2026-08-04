/**
 * Island hydration (#642) — the proof, and the negative control, for the helper that
 * fixes the recurring `offering-catalog:69` CI failure.
 *
 * **The claim under test.** A `"use client"` island is server-rendered, so its markup —
 * including its buttons — exists in the first HTML response. Playwright's actionability
 * checks (visible, stable, enabled, receives events) all pass against that markup. But
 * until React hydrates, no handler is attached, so the click is a **no-op that reports
 * success**. The next assertion then waits out its full timeout against a page that will
 * never change.
 *
 * That claim was a hypothesis on #642, inferred from CI logs. These tests confirm it
 * directly by **blocking the JS bundle** — hydration provably never happens, which is the
 * same end state a slow CI machine reaches by running out of time. Without this, the fix
 * would be a plausible story with a green suite behind it, which is exactly the shape of
 * bug the suite already failed to catch once.
 *
 * Not a `hasTouch`/viewport concern — runs desktop only; hydration timing doesn't vary
 * by viewport.
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsAdmin,
  isHydrated,
  clickHydrated,
} from "./fixtures.js";

/** Everything Next serves to make the page interactive. Blocking it freezes the page
 *  in its server-rendered state permanently — the extreme of "hydration hasn't
 *  happened yet", reached deterministically instead of by racing a slow machine. */
const JS_BUNDLES = "**/_next/static/**/*.js";

test.describe("client islands and hydration", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  /** /admin/offerings?sel=new with the price-variations island on screen. */
  async function openNewOffering(page: import("@playwright/test").Page): Promise<void> {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/offerings?sel=new");
  }

  test("an un-hydrated island accepts a click and does nothing — the CI failure, reproduced", async ({
    page,
  }) => {
    await page.route(JS_BUNDLES, (route) => route.abort());
    await openNewOffering(page);

    const addVariation = page.getByRole("button", { name: "+ Price variation" });

    // The button is real, visible and clickable. This is the part that makes the bug
    // invisible: nothing about the DOM says the page is inert.
    await expect(addVariation).toBeVisible();
    await expect(addVariation).toBeEnabled();
    await addVariation.click(); // resolves fine — Playwright has nothing to object to

    // …and no row appears, because no handler ran. `offering-catalog:69` then waits
    // 15s for this locator and times out. Short timeout here: we are asserting the
    // absence is immediate, not waiting for a row that is never coming.
    await expect(page.getByLabel("Variation 1 label")).toHaveCount(0, { timeout: 2_000 });
  });

  test("isHydrated is false on that same page and true once the bundle loads", async ({
    page,
  }) => {
    // Negative control for the probe itself. A detector that always answered "hydrated"
    // would make the helper below a no-op wait, and every one of these specs would go
    // green while fixing nothing.
    await page.route(JS_BUNDLES, (route) => route.abort());
    await openNewOffering(page);
    expect(await isHydrated(page.getByRole("button", { name: "+ Price variation" }))).toBe(
      false,
    );

    await page.unroute(JS_BUNDLES);
    await openNewOffering(page);
    const addVariation = page.getByRole("button", { name: "+ Price variation" });
    await expect(async () => {
      expect(await isHydrated(addVariation)).toBe(true);
    }).toPass({ timeout: 15_000 });
  });

  test("clickHydrated waits for the handler, so the row actually appears", async ({
    page,
  }) => {
    await openNewOffering(page);
    await clickHydrated(page.getByRole("button", { name: "+ Price variation" }));
    await expect(page.getByLabel("Variation 1 label")).toBeVisible();
  });

  // ── Hydration merely SLOW, which is the actual CI condition ────────────────
  //
  // Blocking the bundle proves the mechanism but overstates it: CI does load the
  // JS, just later than the test clicks. These two tests recreate that exactly —
  // same page, same button, same delay, differing only in which click is used.
  // Without the second one, `clickHydrated` could be a wait on nothing and every
  // spec below would go green on a fast machine while CI kept failing.

  /** Sign in first (needs a working page), THEN slow the bundle and land on the
   *  offering form without waiting for scripts — `commit` returns on the server
   *  HTML, which is the state Playwright acts against when CI is under load. */
  async function openWithSlowBundle(
    page: import("@playwright/test").Page,
  ): Promise<void> {
    await signInAsAdmin(page, "spink");
    await page.route(JS_BUNDLES, async (route) => {
      await new Promise((r) => setTimeout(r, 3_000));
      await route.continue();
    });
    await page.goto("/admin/offerings?sel=new", { waitUntil: "commit" });
  }

  test("a plain click loses the race against a slow bundle", async ({ page }) => {
    await openWithSlowBundle(page);
    await page.getByRole("button", { name: "+ Price variation" }).click();
    // Checked well inside the 3s delay: the click has already been swallowed.
    await expect(page.getByLabel("Variation 1 label")).toHaveCount(0, { timeout: 1_000 });
  });

  test("clickHydrated wins it — the same click, the same delay", async ({ page }) => {
    await openWithSlowBundle(page);
    await clickHydrated(page.getByRole("button", { name: "+ Price variation" }));
    await expect(page.getByLabel("Variation 1 label")).toBeVisible();
  });
});
