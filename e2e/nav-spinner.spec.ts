/**
 * #250 — navigation loading spinner. Clicking a shift row triggers a server RSC
 * fetch for the cockpit pane; while that's in flight, a `<NavSpinner>`
 * (useLinkStatus) shows a spinner at the row's edge — the "clicked → now loading"
 * beat. The board is `force-dynamic`, so the row link isn't prefetched: a click is
 * always a real fetch. We delay that fetch to make the pending frame observable.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const plusDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const board = () => `/admin/shifts?from=${today()}&to=${plusDays(10)}`;

test.describe("nav loading spinner (#250)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("atrisk");
  });

  test("clicking a row shows a loading spinner while the pane loads", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(board());

    // No spinner at rest.
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);

    // Delay the row's ?sel= navigation fetch so the in-flight frame is observable.
    await page.route(
      (url) => url.pathname === "/admin/shifts" && url.search.includes("sel="),
      async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      },
    );

    await page.getByRole("link", { name: /Firkin/ }).click();

    // The loading spinner appears while the pane is fetched...
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
    // ...then the pane lands and the spinner clears.
    await page.waitForURL(/sel=shift-ar-regress/);
    await expect(
      page.getByRole("heading", { level: 2, name: /^Firkin/ }),
    ).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
  });
});
