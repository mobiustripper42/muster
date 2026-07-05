/**
 * #253 — two-pane scroll behaviour. On desktop the board list and the cockpit
 * pane each scroll inside their own column (CSS-only, DEC-085/DEC-042); the WINDOW
 * never scrolls, so opening a pane from deep in a long list — or switching the
 * selected row — can't snap the list back to the top. Below `lg` none of this
 * applies: the list is display-hidden and the cockpit is a full-screen drill-in
 * (unchanged — the regression guard at 375px).
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const plusDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

/** A wide window so the at-risk seed's whole spread of shifts loads (overflows
 * the viewport-bounded list column — the whole point of the test). */
const board = () => `/admin/shifts?from=${today()}&to=${plusDays(10)}`;

test.describe("two-pane scroll (#253)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("desktop: window never scrolls; the columns scroll independently; switching a row can't snap the page", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`${board()}&sel=shift-ar-regress`);

    const boardCol = page.getByTestId("board-col");
    const paneCol = page.getByTestId("pane-col");
    await expect(boardCol).toBeVisible();

    // The list column is its own scroll container (content taller than the box).
    expect(
      await boardCol.evaluate((el) => el.scrollHeight > el.clientHeight + 4),
    ).toBe(true);

    // The WINDOW is not the scroller — it sits at the top with a long list loaded.
    const windowTop = () =>
      page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    expect(await windowTop()).toBe(0);

    // Columns scroll independently: driving the list down leaves the pane at 0.
    await boardCol.evaluate((el) => (el.scrollTop = 300));
    expect(await boardCol.evaluate((el) => el.scrollTop)).toBeGreaterThan(250);
    expect(await paneCol.evaluate((el) => el.scrollTop)).toBe(0);

    // Switch the selected row (the reported repro: this used to snap to top).
    // Playwright may auto-scroll the column to reveal the target — that's fine;
    // the guarantee under test is the WINDOW never moves.
    await page.getByRole("link", { name: /Kettle/ }).click();
    await page.waitForURL(/sel=shift-ar-warming/);
    expect(await windowTop()).toBe(0);

    // The switch landed and the board list survived beside it.
    await expect(
      page.getByRole("heading", { level: 1, name: "All shifts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /^Kettle/ }),
    ).toBeVisible();
  });

  test("375px: a pane is still a full-screen drill-in with the list hidden (no regression)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAsAdmin(page, "spink");
    await page.goto(`${board()}&sel=shift-ar-regress`);

    // The board column is display-hidden at 375px; the cockpit is the surface.
    await expect(page.getByTestId("board-col")).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 1, name: /^Firkin/ }),
    ).toBeVisible();
    // The independent-scroll cage is desktop-only: no lg overflow in play here,
    // so the pane column isn't a bounded scroller (normal-flow full-screen).
    const paneOverflow = await page
      .getByTestId("pane-col")
      .evaluate((el) => getComputedStyle(el).overflowY);
    expect(paneOverflow).toBe("visible");
  });
});
