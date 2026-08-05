/**
 * Crew time clock (#626, SPEC §2.9.7): the round trip a crew member actually makes.
 * The view model is unit-tested (src/crewapp/time-view.test.ts) and the mutex is
 * proven against real Postgres (src/adapters/postgres-repository.test.ts); here we
 * drive the SURFACE — one button, the right one, and the hours it produces.
 * Runs desktop + 375px.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew /crew/time — clock in, clock out", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  // Retitled at #644: the hub no longer carries a Time TILE — the four navigation cards moved
  // into the drawer so the hub could open on work. What still has to hold is that the clock is
  // one tap from the hub, which is what this now says and checks.
  test("the clock is one tap from the hub, via the menu", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.locator(`summary[aria-label="Open menu"]`).click();
    await page.getByRole("link", { name: "Time", exact: true }).click();
    await page.waitForURL(/\/crew\/time$/);
    await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
  });

  test("clock in then out — one button at a time, and the hours land", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time");

    // Out: only Clock in is offered.
    await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clock out" })).toHaveCount(0);
    await expect(page.getByText("No hours yet this period.")).toBeVisible();

    await page.getByRole("button", { name: "Clock in" }).click();
    await page.waitForURL(/in=1/);
    await expect(page.getByText("You’re on the clock.")).toBeVisible();

    // In: the offer flips. Never both — that's the §2.9.7 line.
    await expect(page.getByText(/On the clock since/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Clock out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clock in" })).toHaveCount(0);
    // The open punch is listed but contributes nothing to the total (§2.9.6).
    await expect(page.getByText("still on the clock")).toBeVisible();
    await expect(page.getByText(/Doesn’t include the punch you haven’t closed/)).toBeVisible();

    await page.getByRole("button", { name: "Clock out" }).click();
    await page.waitForURL(/out=1/);
    await expect(page.getByText(/Clocked out/)).toBeVisible();

    // Back to offering Clock in, and the punch is now closed and counted.
    await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();
    await expect(page.getByText("still on the clock")).toHaveCount(0);
    await expect(page.getByText("Total")).toBeVisible();
  });

  test("a second clock-in is refused with a calm notice, not a second punch", async ({
    page,
    context,
  }) => {
    // The double-tap AC. `clockIn`'s read catches the sequential case; the partial
    // unique index catches a genuine race (proven in the Postgres suite). Either
    // way the crew member sees copy, never a 500 — and never two open punches.
    //
    // A SECOND TAB is what makes this real. `page.goBack()` doesn't: the page is
    // `force-dynamic`, so going back re-fetches and re-renders as "Clock out" —
    // the stale button is gone and nothing gets double-posted. Tab B loads while
    // they're still out, tab A clocks in, and tab B's untouched DOM still holds the
    // Clock in form. That's the actual shape of a double-tap.
    await signInAsCrew(page, "crew-quint");
    const stale = await context.newPage();
    await stale.goto("/crew/time");
    await expect(stale.getByRole("button", { name: "Clock in" })).toBeVisible();

    await page.goto("/crew/time");
    await page.getByRole("button", { name: "Clock in" }).click();
    await page.waitForURL(/in=1/);

    // Now post the stale form.
    await stale.getByRole("button", { name: "Clock in" }).click();
    await stale.waitForURL(/err=already_in/);
    await expect(stale.getByText(/already on the clock/i)).toBeVisible();

    // Still exactly one punch, still open — no 500, no second row.
    await page.goto("/crew/time");
    await expect(page.getByText("still on the clock")).toHaveCount(1);
    await stale.close();
  });

  test("edit my own punch: one editor at a time, required note, back to the row", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time");
    // Two closed punches to work with.
    await page.getByRole("button", { name: "Clock in" }).click();
    await page.waitForURL(/in=1/);
    await page.getByRole("button", { name: "Clock out" }).click();
    await page.waitForURL(/out=1/);

    // Edit the punch the clock just made — its times are necessarily in the past,
    // which the no-future guard requires and a hardcoded 09:00–17:00 wouldn't be.
    await page.locator('[id^="punch-"]').first().getByRole("link").first().click();
    await page.waitForURL(/edit=/);

    // ONE editor: every other row is now inert, so there is exactly one Save on screen.
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(1);

    // The note is required — a blank one is refused by the browser before it posts.
    await expect(page.locator('form input[name="reason"]').first()).toHaveAttribute(
      "required",
      "",
    );

    // Widen it by pulling the IN time back an hour — still in the past, so the guard
    // is satisfied and the change is visible in the total.
    const inVal = await page.locator('form input[name="inTime"]').first().inputValue();
    const [hh, mm] = inVal.split(":").map(Number);
    const earlier = `${String(Math.max(0, hh! - 1)).padStart(2, "0")}:${String(mm!).padStart(2, "0")}`;
    await page.locator('form input[name="inTime"]').first().fill(earlier);
    await page.locator('form input[name="reason"]').first().fill("Boat came back late");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByText("Saved.")).toBeVisible();
    // Back to the row, not the top of the list.
    expect(page.url()).toMatch(/#punch-/);
  });

  test("a refused edit keeps the editor open on that row", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time");
    await page.getByRole("button", { name: "Clock in" }).click();
    await page.waitForURL(/in=1/);
    await page.getByRole("button", { name: "Clock out" }).click();
    await page.waitForURL(/out=1/);

    const row = page.locator('[id^="punch-"]').first();
    await row.getByRole("link").first().click();
    await page.waitForURL(/edit=/);

    // An out at/before the in is refused by the DOMAIN, not the browser.
    const inVal = await page.locator('form input[name="inTime"]').first().inputValue();
    await page.locator('form input[name="outTime"]').first().fill(inVal);
    await page.locator('form input[name="reason"]').first().fill("testing the guard");
    await page.getByRole("button", { name: "Save" }).click();

    await page.waitForURL(/err=out_before_in/);
    await expect(page.getByText(/before it started/)).toBeVisible();
    // Still open on that row, so the field they got wrong is in front of them.
    expect(page.url()).toMatch(/edit=/);
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(1);
  });

  test("add a punch I never clocked, on a past day", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time?add=1");
    const today = await page.locator("#new-day").inputValue();
    const [y, m, d] = today.split("-").map(Number);
    const yesterday = new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);

    await page.locator("#new-day").fill(yesterday);
    await page.locator('input[name="inTime"]').fill("09:00");
    await page.locator('input[name="outTime"]').fill("17:00");
    await page.locator('input[name="reason"]').first().fill("Worked the dock, never clocked in");
    await page.getByRole("button", { name: "Save" }).click();

    // Assert on the outcome, not on the row: whether yesterday falls in the CURRENT
    // period depends on where in the fortnight the suite runs, and a test that only
    // passes 13 days out of 14 is the `book-availability` mistake again.
    await page.waitForURL(/added=1/);
    await expect(page.getByText("Added.")).toBeVisible();
  });

  test("the clock buttons can't fire mid-edit and throw the edit away", async ({ page }) => {
    // They post their own forms, so pressing one navigated away and lost the in-progress
    // edit. DirtySubmit's guard covers anchors, beforeunload and the auto-submitting
    // pickers — a submit button on ANOTHER form is none of those.
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time");
    await page.getByRole("button", { name: "Clock in" }).click();
    await page.waitForURL(/in=1/);
    await page.getByRole("button", { name: "Clock out" }).click();
    await page.waitForURL(/out=1/);

    // Nothing open yet: the clock is offered.
    await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();

    await page.locator('[id^="punch-"]').first().getByRole("link").first().click();
    await page.waitForURL(/edit=/);

    // Open editor → the clock is gone, so there is nothing to press by mistake.
    await expect(page.getByRole("button", { name: "Clock in" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clock out" })).toHaveCount(0);
    await expect(page.getByText("Finish the punch you’re editing first.")).toBeVisible();

    // And it comes back when the editor closes.
    await page.getByRole("link", { name: "Cancel" }).click();
    await page.waitForURL(/\/crew\/time(#|$|\?)/);
    await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();
  });

  test("a punch can't be entered in the future", async ({ page }) => {
    // Hours are a record of work done, not a plan (operator, 2026-08-01).
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time?add=1");
    const day = await page.locator("#new-day").inputValue();
    const [y, m, d] = day.split("-").map(Number);
    const tomorrow = new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);

    await page.locator("#new-day").fill(tomorrow);
    await page.locator('input[name="inTime"]').fill("09:00");
    await page.locator('input[name="outTime"]').fill("17:00");
    await page.locator('input[name="reason"]').first().fill("planning ahead");
    await page.getByRole("button", { name: "Save" }).click();

    await page.waitForURL(/err=future/);
    await expect(page.getByText(/hasn’t happened yet|future/i)).toBeVisible();
  });

  test("delete shares the one reason field", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time");
    await page.getByRole("button", { name: "Clock in" }).click();
    await page.waitForURL(/in=1/);
    await page.getByRole("button", { name: "Clock out" }).click();
    await page.waitForURL(/out=1/);

    await page.locator('[id^="punch-"]').first().getByRole("link").first().click();
    await page.waitForURL(/edit=/);
    // ONE reason box serving both buttons.
    await expect(page.locator('form input[name="reason"]')).toHaveCount(1);
    await page.locator('form input[name="reason"]').fill("double punch");
    await page.getByRole("button", { name: "Delete" }).click();

    await page.waitForURL(/deleted=1/);
    await expect(page.getByText("No hours yet this period.")).toBeVisible();
  });

  test("signed out, /crew/time redirects to the crew door", async ({ page }) => {
    await page.goto("/crew/time");
    await page.waitForURL(/\/crew$/);
    await expect(page.getByRole("heading", { name: "Time" })).toHaveCount(0);
  });
});
