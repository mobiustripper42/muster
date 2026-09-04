/**
 * 9.5 (#231, DEC-085) — the two-pane responsive Shift Builder. A board row click
 * opens the shared cockpit body as `?sel=` — beside the board on desktop, as a
 * full-screen drill-in at 375px (the list is display-hidden; "← All shifts" is
 * the way back). Cockpit actions posted from the pane carry the host `ctx` and
 * redirect BACK to the board URL, never out to the standalone route; filter/mode
 * navigation preserves the open pane. The standalone route stays untouched for
 * deep links.
 */
import { test, expect, clickHydrated, resetAndSeed, signInAsAdmin } from "./fixtures.js";

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
    await signInAsAdmin(page, "eric");
    await page.goto(board());

    await page.getByRole("link", { name: /Firkin/ }).click();
    await page.waitForURL(/sel=shift-ar-regress/);

    // Both panes: the board's h1 AND the cockpit body (demoted to h2 in-pane —
    // one h1 per page) with its seat list.
    await expect(
      page.getByRole("heading", { level: 1, name: "All shifts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /^Firkin/ }),
    ).toBeVisible();
    await expect(page.getByText(/required seats confirmed/)).toBeVisible();

    // Close (desktop-only; the ✕ glyph is aria-hidden) collapses back to the
    // single-column board.
    await page.getByRole("link", { name: "Close", exact: true }).click();
    await page.waitForURL((u) => !u.searchParams.has("sel"));
    await expect(page.getByRole("heading", { name: /^Firkin/ })).toHaveCount(0);
  });

  test("a cockpit action posted from the pane redirects back to the board host", async ({
    page,
  }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`${board()}&sel=shift-ar-regress`);

    // The seat override ("Place") rides the hidden ctx → finish() lands on
    // /admin/shifts with sel + the feedback code, not on the standalone cockpit
    // route. (Was the Manning add before that UI was withdrawn — any cockpit
    // action exercises the same ctx round-trip.)
    await page.getByText("Manual override").first().click();
    const picker = page.getByLabel("Crew to place on this seat").first();
    const who = await picker.locator("option").nth(1).getAttribute("value");
    await picker.selectOption(who!);
    await page.getByRole("button", { name: "Place" }).first().click();
    await page.waitForURL(/\/admin\/shifts\?.*overrode=/);
    expect(page.url()).toContain("sel=shift-ar-regress");

    await expect(page.getByText(/placed by override — confirmed\./)).toBeVisible();
    // Still two-pane: the board list survived the round-trip.
    await expect(
      page.getByRole("heading", { level: 1, name: "All shifts" }),
    ).toBeVisible();
  });

  test("mode flip and filter presets preserve the open pane", async ({ page }) => {
    await signInAsAdmin(page, "eric");
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
    await signInAsAdmin(page, "eric");
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

  test("desktop: opening a row reveals it in board-col WITHOUT scrolling the window (#365, DEC-114)", async ({
    page,
  }) => {
    // A short viewport so the board column overflows and the last row sits below
    // its fold — the condition under which the list snapped back to the top, and
    // (crucially) under which the document has enough slack for the window to
    // scroll if the reveal weren't scoped to board-col.
    await page.setViewportSize({ width: 1280, height: 380 });
    await signInAsAdmin(page, "eric");
    await page.goto(`${board()}&sel=shift-ar-regress`);

    const boardCol = page.getByTestId("board-col");
    const rows = boardCol.locator('[id^="shiftrow-"]');
    expect(await rows.count()).toBeGreaterThan(1);

    // Scroll the column to the top, confirm the last row is genuinely below the
    // fold (non-vacuous), then open it and assert the island brought it INTO view.
    await boardCol.evaluate((el) => el.scrollTo(0, 0));
    const lastRow = rows.last();
    const rowId = (await lastRow.getAttribute("id"))!; // shiftrow-<id>
    const sel = rowId.replace("shiftrow-", "");
    await expect(lastRow).not.toBeInViewport();

    await lastRow.getByRole("link").first().click();
    await page.waitForURL((u) => u.searchParams.get("sel") === sel);
    await expect(lastRow).toBeInViewport();
    // The DEC-085 guarantee the pure-CSS anchor broke: the WINDOW never moved.
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
  });

  test("desktop: a mode/filter change with the pane open keeps the selected row revealed (#365, DEC-114)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 380 });
    await signInAsAdmin(page, "eric");
    await page.goto(`${board()}&sel=shift-ar-regress`);

    // Open the pane on the LAST (deep, below-fold) row — the island reveals it.
    const boardCol = page.getByTestId("board-col");
    const lastRow = boardCol.locator('[id^="shiftrow-"]').last();
    const rowId = (await lastRow.getAttribute("id"))!;
    const sel = rowId.replace("shiftrow-", "");
    // `clickHydrated`, though these are plain `<a>`s and navigate without JS (#763). What is
    // under test is not the navigation — it is the REVEAL, which is the island's nav-keyed
    // effect. A click that beats hydration still navigates, as a full page load rather than a
    // client-side route change, and the effect that scrolls the deep row back into view never
    // fires for it. The row then sits below the fold and `toBeInViewport` waits out its whole
    // timeout, which reads as the island being broken rather than never having run.
    await clickHydrated(lastRow.getByRole("link").first());
    await page.waitForURL((u) => u.searchParams.get("sel") === sel);
    await expect(lastRow).toBeInViewport();

    // Flip View→Edit: same rows, pane stays open, board-col re-renders (resets to
    // top). The nav-keyed effect must re-reveal the still-selected deep row.
    await clickHydrated(page.getByRole("link", { name: "Edit", exact: true }));
    await page.waitForURL(/mode=edit/);
    await expect(page.getByTestId("board-col").locator(`#${rowId}`)).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
  });

  test("375px: the reveal island is inert (hidden list) — the drill-in opens at top (#365)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAsAdmin(page, "eric");
    await page.goto(`${board()}&sel=shift-ar-regress`);

    // Below lg the board list is display:none, so the island bails (offsetParent
    // null) and Next's default scroll-to-top leaves the drill-in at the top.
    const heading = page.getByRole("heading", { level: 1, name: /^Firkin/ });
    await expect(heading).toBeVisible();
    const boxTop = (await heading.boundingBox())!.y;
    expect(boxTop).toBeLessThan(200);
  });

  test("the standalone cockpit route still serves deep links", async ({
    page,
  }) => {
    await signInAsAdmin(page, "eric");
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
