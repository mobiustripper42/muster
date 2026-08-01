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

  test("signed out, /crew/time redirects to the crew door", async ({ page }) => {
    await page.goto("/crew/time");
    await page.waitForURL(/\/crew$/);
    await expect(page.getByRole("heading", { name: "Time" })).toHaveCount(0);
  });
});
