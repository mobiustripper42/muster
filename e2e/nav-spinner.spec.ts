/**
 * #250 — navigation loading spinner. Clicking a shift row triggers a server fetch
 * for the cockpit pane; while it's in flight, a prominent `<NavSpinner>`
 * (useLinkStatus) sits over the row — the "clicked → still loading" beat, lasting
 * the whole navigation (pending stays true until the pane renders). The board is
 * `force-dynamic`, so the row link isn't prefetched: a click is always a real fetch.
 * We delay that fetch (simulating the real Neon/Tailscale latency) to observe it.
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

  test("clicking a row shows a loading spinner for the whole navigation, then clears", async ({
    page,
  }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(board());

    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);

    // Delay the row's ?sel= navigation fetch so the in-flight spinner is observable
    // (stands in for the real latency where it stays visible for a second-plus).
    await page.route(
      (url) => url.pathname === "/admin/shifts" && url.search.includes("sel="),
      async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      },
    );

    await page.getByRole("link", { name: /Firkin/ }).click();

    // Spinner is up for the whole fetch...
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
    // ...then the pane lands and it clears (not a beat early).
    await page.waitForURL(/sel=shift-ar-regress/);
    await expect(
      page.getByRole("heading", { level: 2, name: /^Firkin/ }),
    ).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
  });
});
