/**
 * The shared crew header (#644) — one row on every crew surface: back at the far left, heading
 * centred, menu at the far right.
 *
 * **The task was filed as "back arrow → hamburger" and that is the smaller half.** The operator's
 * actual complaint (2026-08-05) was vertical space: `/crew` opened on five full-width navigation
 * cards — Messages, Time, Time off, Calendar sync, Pick up a shift — roughly 330px at 375px, so
 * the shifts a crew member opened the app to see started below the fold. The nav moved into the
 * drawer; the hub keeps only work. SPEC §2.6's stance is "insultingly small", and the hub's
 * navigation count had crept from three to five one DEC at a time with nobody deciding to.
 *
 * So the assertions that matter here are the SPACE ones, not the drawer mechanics: the hub leads
 * with work, and the drill-in header is one row rather than two. The drawer is the means.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

/** Every crew route that carries the shared header, with the heading it should show. */
const ROUTES = [
  { path: "/crew/time", heading: "Time" },
  { path: "/crew/time-off", heading: "Time off" },
  { path: "/crew/calendar", heading: "Calendar sync" },
  { path: "/crew/help", heading: "How Muster works" },
] as const;

test.describe("crew header (#644)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("the hub opens on WORK, not on a menu", async ({ page }) => {
    // The regression that prompted the task, as a number. **Measured on the same seed: "My
    // shifts" began at y=637 before this change and y=411 after**, in an 812px viewport — 226px
    // of navigation handed back to the crew member.
    //
    // The threshold is 450 rather than something tighter because everything still above the list
    // is WORK or status, none of it navigation: the standing line, the "Pick up a shift" offer, a
    // credential nudge, and — the largest single item at 134px — an open ask, which §2.6.1 calls
    // the whole point of the app. Tightening further would force deleting content, not chrome.
    // 450 leaves less than one card's height of slack, so re-adding any of the four nav cards
    // (~66px each) reddens this.
    //
    // A first draft asserted `< 812` and passed on the BROKEN layout — which is how a space test
    // quietly asserts nothing. Both numbers here were measured, not guessed.
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAsCrew(page, "crew-quint");

    const shifts = page.getByRole("heading", { name: "My shifts" });
    await expect(shifts).toBeVisible();
    const box = await shifts.boundingBox();
    expect(box, "My shifts must be laid out").not.toBeNull();
    expect(box!.y).toBeLessThan(450);
  });

  test("the nav cards are gone from the hub and reachable from the menu", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");

    // Not as cards on the page…
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "Time off", exact: true })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Calendar sync", exact: true })).toHaveCount(0);

    // …but one tap away, and still reachable.
    await page.locator(`summary[aria-label="Open menu"]`).click();
    await expect(page.getByRole("link", { name: "Time off", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Calendar sync", exact: true }).click();
    await page.waitForURL(/\/crew\/calendar/);
  });

  test("Pick up a shift STAYS on the hub — it is an offer of work, not a menu item", async ({
    page,
  }) => {
    // DEC-074 calls this "an invitation, not a demand". Burying an offer of work in a menu
    // changes what it is, so it is the one entry that did not move (operator, 2026-08-05).
    await signInAsCrew(page, "crew-quint");
    await expect(
      page.getByRole("main").getByRole("link", { name: /pick up a shift/i }),
    ).toBeVisible();
  });

  for (const { path, heading } of ROUTES) {
    test(`${path}: one header row, centred heading, back and menu on it`, async ({ page }) => {
      // Per route rather than generalised from one — the AC asks for that, and a header that
      // breaks on exactly one page is the normal way this goes wrong.
      await page.setViewportSize({ width: 375, height: 812 });
      await signInAsCrew(page, "crew-quint");
      await page.goto(path);

      const back = page.getByRole("link", { name: /^back/i });
      const title = page.getByRole("heading", { name: heading, level: 1 });
      const menu = page.locator(`summary[aria-label="Open menu"]`);
      await expect(title).toBeVisible();

      const [b, t, m] = await Promise.all([
        back.boundingBox(),
        title.boundingBox(),
        menu.boundingBox(),
      ]);
      expect(b, "back must be laid out").not.toBeNull();
      expect(m, "menu must be laid out").not.toBeNull();

      // One row: all three share a vertical band. The old shape stacked back ABOVE the heading,
      // which is the ~44px this task exists to reclaim.
      const mid = (r: { y: number; height: number }) => r.y + r.height / 2;
      expect(Math.abs(mid(b!) - mid(t!))).toBeLessThan(12);
      expect(Math.abs(mid(m!) - mid(t!))).toBeLessThan(12);

      // Back left of the heading, menu right of it.
      expect(b!.x).toBeLessThan(t!.x);
      expect(m!.x).toBeGreaterThan(t!.x + t!.width - 1);

      // Centred: the gaps either side of the title match within a few px.
      const leftGap = t!.x + t!.width / 2;
      expect(Math.abs(leftGap - 375 / 2)).toBeLessThan(8);

      // Tap targets (AC).
      expect(b!.height).toBeGreaterThanOrEqual(44);
      expect(m!.height).toBeGreaterThanOrEqual(44);
    });
  }

  test("the drawer works with NO JAVASCRIPT, and its links are gone when shut", async ({
    browser,
  }) => {
    // The reason this is a `<details>` and not the admin nav's `useState` island (#644, DEC-147
    // rule 2). The hub's navigation cards moved into the drawer, so a JS-only drawer would leave
    // a crew member with JS off on a page with no way off it — strictly worse than before the
    // task. Run with JS disabled outright, because a drawer that "should" work without it and a
    // drawer that does are different claims.
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    // The sign-in fixture drives a real form POST, which needs no JS either.
    await page.goto("/crew/dev-link?crew=crew-quint");
    await page.getByRole("button", { name: /tap to sign in/i }).click();
    await page.waitForURL((u) => u.pathname === "/crew");

    const link = page.getByRole("link", { name: "Time off", exact: true });
    // Shut: `<details>` keeps its contents out of the render AND the tab order for free. The
    // island version needed `inert` to fake this, and forgetting it is the classic
    // invisible-but-tabbable bug.
    await expect(link).toBeHidden();

    await page.locator(`summary[aria-label="Open menu"]`).click();
    await expect(link).toBeVisible();

    // Keyboard dismissal is the summary, not Escape — native `<details>` has no Escape.
    await page.locator(`summary[aria-label="Open menu"]`).click();
    await expect(link).toBeHidden();
    await ctx.close();
  });
});
