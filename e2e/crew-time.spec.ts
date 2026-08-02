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

  test("the hub carries a Time tile that opens the clock", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
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

    // Add one, which is the same form as edit.
    await page.getByRole("link", { name: "Add hours" }).click();
    await page.waitForURL(/add=1/);
    await page.locator("#new-day").fill(await page.locator("#new-day").inputValue());
    await page.locator('input[name="inTime"]').fill("09:00");
    await page.locator('input[name="outTime"]').fill("17:00");
    await page.locator('input[name="reason"]').first().fill("Worked the dock, never clocked in");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/added=1/);
    await expect(page.getByText("Added.")).toBeVisible();
    // Twice on purpose — the row AND the period total, which is the stronger assertion.
    await expect(page.getByText("8h")).toHaveCount(2);

    // Open that punch for editing by clicking its ROW (not the text, which the total
    // also carries). The URL carries which one is open.
    await page.locator('[id^="punch-"]').filter({ hasText: "8h" }).getByRole("link").first().click();
    await page.waitForURL(/edit=/);

    // ONE editor: every other row is now inert, so there is exactly one Save on screen.
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(1);

    // The note is required — a blank one is refused by the browser before it posts.
    await expect(page.locator('form input[name="reason"]').first()).toHaveAttribute(
      "required",
      "",
    );

    await page.locator('form input[name="outTime"]').first().fill("18:30");
    await page.locator('form input[name="reason"]').first().fill("Boat came back late");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByText("9h 30m")).toHaveCount(2);
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
