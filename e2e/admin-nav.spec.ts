/**
 * Persistent admin nav (#174): the operator sees the bar on every admin surface,
 * the active link follows the route, and a signed-out / crew visitor sees no
 * operator chrome. Responsive — desktop inline links, mobile hamburger → slide-in
 * drawer. Runs at desktop + 375px (the mobile drawer is exercised at 375).
 */
import { test, expect, resetAndSeed, signInAsCrew, signInAsAdmin } from "./fixtures.js";

/** On mobile the links live behind the hamburger; open it first. No-op on desktop. */
async function openMenuIfMobile(page: import("@playwright/test").Page): Promise<void> {
  const burger = page.getByRole("button", { name: "Open menu" });
  if (await burger.isVisible()) await burger.click();
}

test.describe("admin nav", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("#586: the links never paint over the brand cluster", async ({ page }, testInfo) => {
    // The bug: at 1280px with twelve links, the inline row carried `shrink-0`, overflowed the
    // `max-w-3xl` container, and rendered straight on top of `Muster · BrewBoat · Tue, Jul 28 ·
    // Crew view`. Nothing asserted nav layout, so it shipped and was found by clicking.
    //
    // e2e runs with RESERVATIONS=true and MESSAGING=1, so all thirteen entries render here —
    // strictly worse than any real deployment, which is what makes this the right place to pin it.
    test.skip(testInfo.project.name !== "desktop", "desktop-only: at 375px the links are behind the hamburger");
    await signInAsAdmin(page, "spink");
    const nav = page.getByRole("navigation", { name: "Admin" });

    const crewView = nav.getByRole("button", { name: "Crew view" });
    const firstLink = nav.getByRole("link", { name: "At-Risk" });
    const left = await crewView.boundingBox();
    const right = await firstLink.boundingBox();
    expect(left, "Crew view must be laid out").not.toBeNull();
    expect(right, "the first nav link must be laid out").not.toBeNull();

    // The whole bug in one assertion: the link row starts after the brand cluster ends.
    expect(right!.x).toBeGreaterThanOrEqual(left!.x + left!.width);

    // And the row still fits on one line — the 52px height budget the two-pane shell subtracts
    // (#253). The previous fix for this collision (gap-5) bought width by wrapping and broke it.
    const bar = await nav.boundingBox();
    expect(bar!.height).toBeLessThanOrEqual(56);
  });

  test("#603: one group open at a time, and a click elsewhere closes it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the dropdowns are the desktop rendering");
    await signInAsAdmin(page, "spink");
    const nav = page.getByRole("navigation", { name: "Admin" });
    const group = (label: string) => nav.locator("summary:visible").filter({ hasText: label });

    await group("Bookings").click();
    await expect(nav.locator("details[open]")).toHaveCount(1);

    // `name` on <details> makes the browser close the others. Without it every group could sit
    // open at once and the panels overlapped each other on a sticky bar.
    await group("Setup").click();
    await expect(nav.locator("details[open]")).toHaveCount(1);
    await expect(group("Setup").locator("xpath=..")).toHaveAttribute("open", "");

    // A <details> never closes on an outside click by itself, so a panel opened by accident
    // would sit over the page until you clicked its summary again.
    await page.locator("h1").first().click();
    await expect(nav.locator("details[open]")).toHaveCount(0);

    // …nor on navigation: the nav lives in the layout, so a client-side route change does not
    // remount it and the panel would hang over the new page.
    await group("Bookings").click();
    await nav.getByRole("link", { name: "Customers" }).click();
    await page.waitForURL(/\/admin\/customers/);
    await expect(nav.locator("details[open]")).toHaveCount(0);
  });

  test("admin navigates via the bar; the active link follows the route", async ({ page }) => {
    await signInAsAdmin(page, "spink"); // lands on /admin/at-risk
    const nav = page.getByRole("navigation", { name: "Admin" });
    await expect(nav.getByRole("link", { name: "Muster" })).toBeVisible();

    await openMenuIfMobile(page);
    await expect(nav.getByRole("link", { name: "At-Risk" })).toHaveAttribute("aria-current", "page");

    // A flat link, deliberately: this test is about the active cue following the route, not
    // about group mechanics (Outbox moved under Settings ▾ in #603 — covered by the Messages
    // test below, which opens a group first).
    await nav.getByRole("link", { name: "Import" }).click(); // closes the drawer on mobile
    await page.waitForURL(/\/admin\/import/);

    await openMenuIfMobile(page);
    await expect(nav.getByRole("link", { name: "Import" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "At-Risk" })).not.toHaveAttribute("aria-current", "page");
  });

  test("9.12: the nav links the built Messages surface (#238)", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    const nav = page.getByRole("navigation", { name: "Admin" });
    await openMenuIfMobile(page);
    // Desktop: Messages is shelved under People (#603) — open the group first. The drawer
    // renders every group expanded, so this is a no-op there.
    const people = nav.locator("summary:visible").filter({ hasText: "People" });
    if (await people.isVisible()) await people.click();
    await nav.getByRole("link", { name: "Messages" }).click();
    await page.waitForURL(/\/admin\/messages/);
    await openMenuIfMobile(page);
    // The group closes after a selection (#603), so the you-are-here cue is the highlighted
    // GROUP, not a visible link — the operator's call: "if Time Off is selected, then just
    // People will be highlighted."
    await expect(nav.locator("summary:visible").filter({ hasText: "People" })).toHaveAttribute(
      "data-active",
      "",
    );
  });

  test("desktop: the nav fits the two-pane height budget (guards #253)", async ({ page }) => {
    // The two-pane board's independent-scroll layout (#253) bounds its shell to
    // `calc(100dvh - 3.25rem)` on lg, where 3.25rem (52px) is the budget for this
    // sticky nav. That constant lives in shell.tsx and can't see the nav; if the
    // nav ever outgrows 52px the calc under-subtracts and the #253 scroll-snap
    // quietly returns. This pins the budget so that change fails CI here instead.
    const width = page.viewportSize()?.width ?? 0;
    test.skip(width < 1024, "the fill-height budget only applies at lg (≥1024px)");
    await signInAsAdmin(page, "spink");
    const nav = page.getByRole("navigation", { name: "Admin" });
    const height = await nav.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(52); // 3.25rem — the shell.tsx cutoff
  });

  test("mobile: the hamburger toggles the drawer; a link tap navigates + closes it", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    const burger = page.getByRole("button", { name: "Open menu" });
    test.skip(!(await burger.isVisible()), "desktop: inline links, no hamburger");

    // Closed → open: aria-expanded is the reliable state signal (a transformed
    // off-screen drawer still reads "visible" to Playwright, so assert on this).
    await expect(burger).toHaveAttribute("aria-expanded", "false");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-expanded", "true");

    // The drawer's Shifts link is now on-screen + actionable; tapping it navigates.
    await page.getByRole("link", { name: "Shifts" }).click();
    await page.waitForURL(/\/admin\/shifts/);
    // …and the drawer closed itself on the route change.
    await expect(burger).toHaveAttribute("aria-expanded", "false");
  });

  test("a signed-out visitor sees no operator nav", async ({ page }) => {
    await page.goto("/admin/at-risk");
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });

  test("a crew subject sees no admin nav", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/admin/at-risk");
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });
});
