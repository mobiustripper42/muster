/**
 * Persistent admin nav (#174): the operator sees the bar on every admin surface,
 * the active link follows the route, and a signed-out / crew visitor sees no
 * operator chrome. Responsive — desktop inline links, mobile hamburger → slide-in
 * drawer. Runs at desktop + 375px (the mobile drawer is exercised at 375).
 */
import {
  test,
  expect,
  resetAndSeed,
  signInAsCrew,
  signInAsAdmin,
  clickHydrated,
  isHydrated,
} from "./fixtures.js";

/**
 * The visible "People" group. BOTH navs are in the DOM at every width — the inline bar
 * (`details[name="admin-nav"]`) and the drawer (`details[name="admin-drawer"]`) — so an
 * unscoped `locator("details")` resolves to whichever is hidden at this viewport and times out
 * on a click. Filtering on visibility picks the one this width actually uses.
 */
function peopleGroup(page: import("@playwright/test").Page) {
  // `summary:visible` then up to its <details> — the idiom the #603 test already uses here.
  // Selecting the <details> directly and filtering on visibility does NOT work: at desktop width
  // it matches nothing, and at 375px it matches the hidden bar's copy as readily as the drawer's.
  return page
    .getByRole("navigation", { name: "Admin" })
    .locator("summary:visible")
    .filter({ hasText: "People" })
    .locator("xpath=..");
}

/**
 * Open the People group with React provably listening (#655).
 *
 * Two different waits, for two different reasons. The `<summary>` toggle is native, so opening
 * the group needs no JS and a plain click is correct. But every assertion about whether the group
 * STAYS open is an assertion about `onFocusOut`, which only exists once the nav has hydrated —
 * so without this gate a green test could mean "the handler never ran", which is exactly the
 * failure it is meant to catch.
 */
async function openGroupHydrated(page: import("@playwright/test").Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Admin" });
  await expect
    .poll(() => isHydrated(nav), { timeout: 15_000, message: "admin nav never hydrated" })
    .toBe(true);
  const group = peopleGroup(page);
  await group.locator("summary:visible").click();
  await expect(group).toHaveAttribute("open", "");
}

/** On mobile the links live behind the hamburger; open it first. No-op on desktop. */
async function openMenuIfMobile(page: import("@playwright/test").Page): Promise<void> {
  const burger = page.getByRole("button", { name: "Open menu" });
  if (await burger.isVisible()) await clickHydrated(burger);
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

    // …nor on tabbing out: Enter on a group, tab past its links, and focus lands on the next
    // group's summary with the first panel still floating over the page.
    await group("Bookings").click();
    await expect(nav.locator("details[open]")).toHaveCount(1);
    for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
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
    await clickHydrated(burger);
    await expect(burger).toHaveAttribute("aria-expanded", "true");

    // The drawer's Shifts link is now on-screen + actionable; tapping it navigates.
    await page.getByRole("link", { name: "Shifts" }).click();
    await page.waitForURL(/\/admin\/shifts/);
    // …and the drawer closed itself on the route change.
    await expect(burger).toHaveAttribute("aria-expanded", "false");
  });

  test("#655: a group survives focus landing nowhere — the iPhone tap", async ({ page }) => {
    // Reported on an iPhone: open a nav group, tap Payroll or Time off, and the menu just
    // closes without navigating. Ungrouped links (Shifts, Calendar) were fine, and Android was
    // fine — so it is not a dead link, it is the group closing out from under the tap.
    //
    // `onFocusOut` closes every open group when focus leaves and lands NOWHERE. Desktop and
    // Android Chrome focus a link on tap, so `relatedTarget` is the link and it is contained.
    // Safari on iOS does not focus a link on tap, so `relatedTarget` is null, the panel closes,
    // and the link is pulled out of the layout before the click can resolve against it.
    //
    // Chromium cannot reproduce the iOS focus behaviour, but it does not need to: the defect is
    // in OUR branch, so dispatching the focusout Safari would have produced exercises it here.
    // No extra goto: signInAsAdmin already lands on /admin/at-risk, which carries the nav.
    // Navigating again races the sign-in redirect in dev mode and interrupts it.
    await signInAsAdmin(page, "spink");
    await openMenuIfMobile(page);

    // The <summary> toggle is native — HTML's own accordion, no JS — so a plain click is right
    // here and `clickHydrated` would be waiting on nothing (it also fails: a server-rendered
    // <span> inside <summary> never carries `__reactProps$`). But the ASSERTION below needs the
    // React listener attached, or this passes for the worst possible reason: no handler ran, so
    // of course nothing closed. Gate on hydration explicitly.
    await openGroupHydrated(page);
    const group = peopleGroup(page);

    // The gesture, as this handler sees it.
    await group.locator("summary").dispatchEvent("focusout", { relatedTarget: null });

    await expect(group).toHaveAttribute("open", "");
    await expect(page.getByRole("link", { name: "Payroll" })).toBeVisible();
    await page.getByRole("link", { name: "Payroll" }).click();
    await page.waitForURL(/\/admin\/payroll/);
  });

  test("#655: a REAL tap on a grouped link navigates (WebKit)", async ({ page }, testInfo) => {
    // **This does NOT reproduce #655, and it is labelled that way on purpose.** It was written
    // expecting Playwright's WebKit to execute the real gesture Chromium cannot. Negative
    // control says otherwise: revert the one-line fix and this still passes, while the sibling
    // synthetic test reddens. Linux WebKit is the same engine as Safari but not the same
    // platform, and it evidently focuses a link on tap the way Chromium does — so the behaviour
    // the bug depends on is absent here.
    //
    // Kept as a smoke test, not a regression guard: it asserts a grouped link is tappable at all
    // under WebKit with touch. The synthetic focusout test is the only thing standing between
    // this bug and the operator's phone. Deleting this would be defensible; leaving it MISLABELLED
    // would not, because a test that cannot fail for the reason in its name launders a claim.
    //
    // Runs only in the `iphone` project (WebKit + isMobile + hasTouch). `tap()` requires touch,
    // so this would fail as a setup error rather than a finding anywhere else.
    test.skip(testInfo.project.name !== "iphone", "needs WebKit with touch");
    // No extra goto: signInAsAdmin already lands on /admin/at-risk, which carries the nav.
    // Navigating again races the sign-in redirect in dev mode and interrupts it.
    await signInAsAdmin(page, "spink");
    await openMenuIfMobile(page);
    await openGroupHydrated(page);

    await page.getByRole("link", { name: "Payroll" }).tap();
    await page.waitForURL(/\/admin\/payroll/);
  });

  test("#655: tabbing out of a group still closes it — the case onFocusOut exists for", async ({
    page,
  }) => {
    // The other half. The handler was added because tabbing past a group's links left the panel
    // floating over the page on a sticky bar. Narrowing it to "focus landed somewhere outside"
    // must not cost that: a tab always carries a relatedTarget, so this stays closed.
    // No extra goto: signInAsAdmin already lands on /admin/at-risk, which carries the nav.
    // Navigating again races the sign-in redirect in dev mode and interrupts it.
    await signInAsAdmin(page, "spink");
    await openMenuIfMobile(page);

    await openGroupHydrated(page);
    const group = peopleGroup(page);

    // A REAL focus move, not a synthetic dispatch. `dispatchEvent` does not carry
    // `relatedTarget` through, so a synthetic focusout is always a null one — it would have
    // re-tested the case above while claiming to test this one, and passed for the wrong reason.
    // Moving focus for real makes the browser populate `relatedTarget` itself.
    await group.locator("summary").focus();
    await page.getByRole("link", { name: "Muster", exact: true }).focus();
    await expect(group).not.toHaveAttribute("open", "");
  });

  test("a signed-out visitor sees no operator nav", async ({ page }) => {
    await page.goto("/admin/at-risk");
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });

  test("a crew subject sees no admin nav", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    // `signInAsCrew` returns on the URL change, which can be before the load settles — a goto
    // fired into that window is cancelled outright ("interrupted by another navigation"). Only
    // dev mode is slow enough to lose the race, so it is latent in CI (which runs `next dev`)
    // rather than specific to this project. Fixed locally; the shared fixture is used by every
    // spec and is not something to change at the tail of an unrelated task.
    await page.waitForLoadState("load");
    await page.goto("/admin/at-risk");
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });
});
