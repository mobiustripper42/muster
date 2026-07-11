/**
 * 9.5 (#231, DEC-085) — the two-pane responsive Shift Builder. A board row click
 * opens the shared cockpit body as `?sel=` — beside the board on desktop, as a
 * full-screen drill-in at 375px (the list is display-hidden; "← All shifts" is
 * the way back). Cockpit actions posted from the pane carry the host `ctx` and
 * redirect BACK to the board URL, never out to the standalone route; filter/mode
 * navigation preserves the open pane. The standalone route stays untouched for
 * deep links.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const plusDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

/** The at-risk seed's window (its trips anchor ≤ ~5 days out). */
const board = () => `/admin/shifts?from=${today()}&to=${plusDays(10)}`;

test.describe("two-pane builder (9.5, DEC-085)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("a row click opens the cockpit pane beside the board (desktop)", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(board());

    await page.getByRole("link", { name: /Firkin/ }).click();
    await page.waitForURL(/sel=shift-ar-regress/);

    // Both panes: the board's h1 AND the cockpit body (demoted to h2 in-pane —
    // one h1 per page) with its Manning section.
    await expect(
      page.getByRole("heading", { level: 1, name: "All shifts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /^Firkin/ }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Manning" })).toBeVisible();

    // Close (desktop-only; the ✕ glyph is aria-hidden) collapses back to the
    // single-column board.
    await page.getByRole("link", { name: "Close", exact: true }).click();
    await page.waitForURL((u) => !u.searchParams.has("sel"));
    await expect(page.getByRole("heading", { name: /^Firkin/ })).toHaveCount(0);
  });

  test("a cockpit action posted from the pane redirects back to the board host", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`${board()}&sel=shift-ar-regress`);

    // The Manning add rides the hidden ctx → finish() lands on /admin/shifts
    // with sel + the feedback code, not on the standalone cockpit route.
    await page.getByRole("button", { name: "+ Required hand" }).first().click();
    await page.waitForURL(/\/admin\/shifts\?.*manning_added=required/);
    expect(page.url()).toContain("sel=shift-ar-regress");

    await expect(
      page.getByText(/Added a required hand — the shift needs one more to crew\./),
    ).toBeVisible();
    // Still two-pane: the board list survived the round-trip.
    await expect(
      page.getByRole("heading", { level: 1, name: "All shifts" }),
    ).toBeVisible();
  });

  test("mode flip and filter presets preserve the open pane", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`${board()}&sel=shift-ar-regress`);

    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await page.waitForURL(/mode=edit/);
    expect(page.url()).toContain("sel=shift-ar-regress");
    await expect(
      page.getByRole("heading", { level: 2, name: /^Firkin/ }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Week", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("sel") === "shift-ar-regress");
    await expect(
      page.getByRole("heading", { level: 2, name: /^Firkin/ }),
    ).toBeVisible();
  });

  test("375px: the drill-in is full-screen with '← All shifts' as the way back", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAsAdmin(page, "spink");
    await page.goto(`${board()}&sel=shift-ar-regress`);

    // The board list is display-hidden on mobile — cockpit only. With the
    // board's h1 out of the a11y tree, the cockpit's own heading is the page's
    // h1 (the level tracks the breakpoint, not just the host).
    await expect(
      page.getByRole("heading", { name: "All shifts" }),
    ).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 1, name: /^Firkin/ }),
    ).toBeVisible();

    // The arrow glyph is aria-hidden (9.8) — the accessible name is the words.
    await page.getByRole("link", { name: "All shifts", exact: true }).click();
    await page.waitForURL((u) => !u.searchParams.has("sel"));
    await expect(page.getByRole("heading", { name: "All shifts" })).toBeVisible();
  });

  test("desktop: a row click reveals that row via the #shiftrow anchor, not a snap to top (#365)", async ({
    page,
  }) => {
    // A short viewport so the board column overflows and actually scrolls — the
    // condition under which the old behaviour snapped the list back to the top.
    await page.setViewportSize({ width: 1280, height: 380 });
    await signInAsAdmin(page, "spink");
    await page.goto(`${board()}&sel=shift-ar-regress`);

    const boardCol = page.getByTestId("board-col");
    const rowLinks = boardCol.locator('a[href*="#shiftrow-"]');
    // Mechanism: every row link carries its own #shiftrow-<id> fragment.
    expect(await rowLinks.count()).toBeGreaterThan(1);

    // Click the LAST row (below the fold on a short viewport) with the column
    // scrolled to the top, then assert it's brought INTO view — the anchor did its
    // job instead of resetting board-col to scrollTop 0.
    await boardCol.evaluate((el) => el.scrollTo(0, 0));
    const last = rowLinks.last();
    const href = await last.getAttribute("href");
    const anchorId = href!.split("#")[1]!; // shiftrow-<id>
    await last.click();
    await page.waitForURL((u) => u.href.includes(`#${anchorId}`));
    await expect(boardCol.locator(`#${anchorId}`)).toBeInViewport();
  });

  test("375px: the #shiftrow anchor is inert (hidden list) — the drill-in opens at top (#365)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAsAdmin(page, "spink");
    // Land via a row href exactly as the list would build it — sel + the fragment.
    await page.goto(`${board()}&sel=shift-ar-regress#shiftrow-shift-ar-regress`);

    // The board list is display-hidden at 375px, so the fragment target has no box
    // and the browser can't jump to it — the cockpit drill-in must sit at the top.
    const heading = page.getByRole("heading", { level: 1, name: /^Firkin/ });
    await expect(heading).toBeVisible();
    const boxTop = (await heading.boundingBox())!.y;
    expect(boxTop).toBeLessThan(200);
  });

  test("the standalone cockpit route still serves deep links", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/shift/shift-ar-regress");

    // h1 standalone (the host supplies the heading level), no pane furniture,
    // and the AdminNav carries wayfinding (the hardcoded "← At-Risk board"
    // back-link was dropped in 9.7 — it lied about non-board entries).
    await expect(
      page.getByRole("heading", { level: 1, name: /^Firkin/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "At-Risk" }),
    ).toBeVisible();
    await expect(page.getByText("← At-Risk board")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All shifts" })).toHaveCount(0);
  });
});
