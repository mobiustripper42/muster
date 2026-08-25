/**
 * Nothing stops you navigating away from a half-filled form (#781).
 *
 * Issue #699 and issue #780 cover work lost to a **refused save**. This covers the ordinary way
 * it disappears: a half-filled form, a click on the master list inches away, and it is gone with
 * no prompt and no trace.
 *
 * ## What already existed, and why these tests are not starting from nothing
 *
 * `components/admin/dirty-submit.tsx` has guarded `beforeunload` and in-app anchor clicks since
 * the time-clock work, but it is mounted on exactly two of the ten draft surfaces — `/crew/time`
 * and `/admin/time-clock` — and it is welded to a disabled-until-dirty Save button that the other
 * eight surfaces must not inherit (`Create` on an empty add-on form would render dead). So the
 * guard gets split out; these tests pin the behaviour that split has to preserve and extend.
 *
 * ## The dirty definition, which is the whole design question (#781 says so)
 *
 * "Dirty" is a **comparison against the values the form was born with**, not a record of whether
 * any input event ever fired. The difference is one test below — *typing and undoing it* — and it
 * is the difference between a guard that is right and a guard that gets muted by the person it is
 * protecting. `DirtySubmit` currently uses input events and fails that case.
 *
 * ## Reading a `confirm()` in Playwright
 *
 * Playwright auto-dismisses dialogs when no handler is registered, and a dismissed `confirm()`
 * returns false — so an unhandled prompt *blocks* the navigation rather than hanging the run.
 * Every test here registers a handler anyway and asserts on the count, because "did it prompt"
 * and "did it navigate" are two facts and a test that checks only the second passes for the wrong
 * reason on a surface with no guard at all.
 */
import {
  expect,
  isHydrated,
  resetAndSeed,
  signInAsAdmin,
  signInAsCrew,
  test,
} from "./fixtures.js";

/**
 * Block until React owns the guard inside this form.
 *
 * The island attaches its listeners at hydration, and on a compile-on-demand dev route the form
 * is typeable well before that. A test that clicks away inside that window reads as "no guard"
 * and reports nothing about whether the guard works — which is what the crew case did, twice,
 * for two different reasons. Nothing can guard before it exists; that window is the no-JS case
 * and is the accepted status quo (DEC-147).
 *
 * Waits on `isHydrated` (`e2e/fixtures.ts:274`) rather than on the history sentinel, which reads
 * as a tempting proxy and is not one: Next's router rewrites `history.state` during a soft
 * navigation and drops our marker, so polling for it fails on a guard that is working.
 */
async function guardReady(
  page: import("@playwright/test").Page,
  formSelector: string,
): Promise<void> {
  await expect
    .poll(() => isHydrated(page.locator(`${formSelector} [data-testid="unsaved-guard"]`)), {
      message: `the guard in ${formSelector} never hydrated`,
    })
    .toBe(true);
}

/** One saved add-on, so the master list has a row to navigate away TO. */
async function seedOneAddOn(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/admin/add-ons?sel=new");
  await page.fill('input[name="label"]', "Existing Cooler of Ice");
  await page.fill('input[name="amount"]', "25.00");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/saved=1/);
}

/**
 * Record every dialog and dismiss it. Returns the live array — read it AFTER the action.
 *
 * Dismissing rather than accepting is deliberate: "the operator said no" is the case where the
 * guard has to actually stop something, and a test that always accepts can't tell a working
 * guard from a prompt that fires and is ignored.
 */
function captureDialogs(page: import("@playwright/test").Page): string[] {
  const seen: string[] = [];
  page.on("dialog", async (d) => {
    seen.push(d.message());
    await d.dismiss();
  });
  return seen;
}

test.describe("the unguarded exit (#781)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("admin: a half-filled create form warns before an in-app navigation", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await seedOneAddOn(page);

    await page.goto("/admin/add-ons?sel=new");
    await page.fill('input[name="label"]', "Sunset Charcuterie");
    await page.fill('input[name="amount"]', "45.00");

    const dialogs = captureDialogs(page);

    // The master–detail case the issue names: the list that navigates away sits inches from the
    // fields being typed into. An `AppLink` (`page.tsx:114`) — a client-side push that fires no
    // `beforeunload`, which is why the anchor click has to be intercepted separately.
    await page.getByRole("link", { name: "Existing Cooler of Ice" }).click();

    await expect.poll(() => dialogs.length, { message: "no warning was shown" }).toBeGreaterThan(0);

    // Dismissed, so nothing moved and the typing survived.
    await expect(page).toHaveURL(/sel=new/);
    await expect(page.locator('input[name="label"]')).toHaveValue("Sunset Charcuterie");
    await expect(page.locator('input[name="amount"]')).toHaveValue("45.00");
  });

  test("admin: typing and undoing it leaves the form clean — no warning", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await seedOneAddOn(page);

    await page.goto("/admin/add-ons?sel=new");
    // Type, then put it back exactly as it was born. An input-event definition of "dirty" is
    // stuck ON here; a comparison against the mount-time values reads clean. This is the test
    // that chooses between the two, and the reason issue #781 calls the definition the real work.
    await page.fill('input[name="label"]', "Sunset Charcuterie");
    await page.fill('input[name="label"]', "");

    const dialogs = captureDialogs(page);
    await page.getByRole("link", { name: "Existing Cooler of Ice" }).click();

    await page.waitForURL(/sel=(?!new)/);
    expect(dialogs, "warned about a form that holds nothing new").toEqual([]);
  });

  test("admin: an untouched form does not warn", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await seedOneAddOn(page);

    await page.goto("/admin/add-ons?sel=new");

    const dialogs = captureDialogs(page);
    await page.getByRole("link", { name: "Existing Cooler of Ice" }).click();

    await page.waitForURL(/sel=(?!new)/);
    expect(dialogs, "warned about a form nobody touched").toEqual([]);
  });

  test("admin: submitting the form does not warn", async ({ page }) => {
    await signInAsAdmin(page, "spink");

    await page.goto("/admin/add-ons?sel=new");
    await page.fill('input[name="label"]', "Sunset Charcuterie");
    await page.fill('input[name="amount"]', "45.00");

    const dialogs = captureDialogs(page);
    await page.getByRole("button", { name: "Create" }).click();

    await page.waitForURL(/saved=1/);
    expect(dialogs, "saving argued with the operator on the way out").toEqual([]);
  });

  test("admin: the form restored after a refusal is not dirty", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await seedOneAddOn(page);

    await page.goto("/admin/add-ons?sel=new");
    await page.fill('input[name="label"]', "Sunset Charcuterie");
    await page.fill('input[name="amount"]', "forty five");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/err=bad_amount/);

    // The draft (#699) hands the operator's own values back as the form's DEFAULTS, so the
    // restored form is born holding them and starts clean. A guard that measured input events
    // across the redirect, or snapshotted before the restore, would nag about work it just
    // returned — the constraint issue #781 states as "must not prompt on a navigation the
    // operator did not choose".
    await expect(page.locator('input[name="amount"]')).toHaveValue("forty five");

    const dialogs = captureDialogs(page);
    await page.getByRole("link", { name: "Existing Cooler of Ice" }).click();

    await page.waitForURL(/sel=(?!new)/);
    expect(dialogs, "nagged about the values it had just restored").toEqual([]);
  });

  test("admin: the browser Back button warns on a dirty form", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await seedOneAddOn(page);

    // **Reached by clicking, not by `goto`.** Two `page.goto()` calls build two separate
    // DOCUMENTS, and a history step between documents unloads the page instead of firing
    // `popstate` — so a sentinel-based guard cannot see it, and the first cut of this test
    // failed for that reason rather than for a missing guard. An operator gets here through
    // the master list, which is a soft navigation inside one document. The test has to use the
    // same door or it is measuring a navigation the app never performs.
    await page.goto("/admin/add-ons");
    await page.getByRole("link", { name: "+ New add-on" }).click();
    await page.waitForURL(/sel=new/);
    await guardReady(page, "form");
    await page.fill('input[name="label"]', "Sunset Charcuterie");

    const dialogs = captureDialogs(page);

    // Back fires neither `beforeunload` (no document unload on a soft navigation) nor a click
    // (no anchor), so it is the one exit neither existing mechanism covers. The operator calls
    // this the only problem that really matters.
    await page.goBack().catch(() => {
      // A guard that blocks the pop leaves `goBack()` with no navigation to await. That is the
      // PASSING shape here, so the rejection is swallowed and the assertions below decide.
    });

    // Polled, not read straight. `page.goBack()` resolves as soon as the traversal is done; the
    // dialog event reaches Node a beat later, so a synchronous read of this array is 0 on a
    // working guard. That cost an hour of chasing a guard that was already firing correctly.
    await expect
      .poll(() => dialogs.length, { message: "Back walked off with the edit and said nothing" })
      .toBeGreaterThan(0);
    await expect(page).toHaveURL(/sel=new/);
    await expect(page.locator('input[name="label"]')).toHaveValue("Sunset Charcuterie");
  });

  test("crew: the same guard covers a crew surface", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");

    await page.goto("/crew/time-off");
    await guardReady(page, 'form:has(input[name="start"])');
    await page.locator('input[name="start"]').fill("2026-09-01");

    const dialogs = captureDialogs(page);
    // `CrewHeader`'s back link (`page.tsx:83`) — the exit a crew member actually takes off a
    // half-filled request, and a different layout and sign-in from every test above.
    await page.getByRole("link", { name: "My shifts" }).click();

    await expect
      .poll(() => dialogs.length, { message: "the crew surface has no guard" })
      .toBeGreaterThan(0);
    await expect(page).toHaveURL(/time-off/);
    await expect(page.locator('input[name="start"]')).toHaveValue("2026-09-01");
  });

  test("crew: two dirty forms on one page ask once, not twice", async ({ page }) => {
    // `/crew/time-off` renders the add-a-window form and the weekday-blackout form side by side,
    // and either can hold an edit. With a listener per guarded form, one click ran the prompt
    // once per armed guard — two native dialogs back to back for one click, and an operator who
    // confirmed the first could reflexively dismiss the second and end up blocked on a page they
    // had already agreed to leave. Found by `@code-review` on this branch.
    //
    // This test is why the click path asks through `confirmLeaveOnce` and why the Back trap is
    // refcounted page-wide rather than pushed per form: there is one back stack and one operator,
    // so there is one question.
    await signInAsCrew(page, "crew-quint");

    await page.goto("/crew/time-off");
    await guardReady(page, 'form:has(input[name="start"])');
    await guardReady(page, 'form:has(input[name="days"])');

    await page.locator('input[name="start"]').fill("2026-09-01");
    await page.locator('input[name="days"]').first().click();

    // **Accepted, not dismissed — and that is the whole test.** Declining calls
    // `stopPropagation()`, which stops the second guard's listener ever running, so a dismissed
    // prompt shows one dialog whether or not the bug is present. The first cut of this test
    // dismissed, passed with the fix reverted, and proved nothing. Only the accept path lets the
    // event keep propagating to the next armed guard, which is where the second dialog came from.
    const dialogs: string[] = [];
    page.on("dialog", async (d) => {
      dialogs.push(d.message());
      await d.accept();
    });

    await page.getByRole("link", { name: "My shifts" }).click();

    await expect
      .poll(() => dialogs.length, { message: "neither guard asked" })
      .toBeGreaterThan(0);
    await page.waitForURL(/\/crew$/);
    // Settle, then confirm no SECOND dialog arrived behind the first.
    await page.waitForTimeout(1000);
    expect(dialogs, "asked once per guarded form instead of once per click").toHaveLength(1);
  });
});
