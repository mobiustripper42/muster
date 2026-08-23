/**
 * A refused save must not destroy a crew member's typing either (#780).
 *
 * The crew half of `admin-form-error.spec.ts`. Same defect, same mechanism, one extra reason to
 * exist: until #780 the draft cookie's `Path` was built as `` `/admin/${surface}` ``, so on
 * `/crew/*` it was set at a path the browser would never send back. Every call site read as
 * correct and the form still came back empty. These tests are the end-to-end half of that; the
 * derivation itself is pinned in `app/lib/form-draft.test.ts`.
 *
 * **What is worth losing here is the reason.** Both crew surfaces require a short written note
 * — it is the whole point of the audit trail — and it is the one field on the form that cannot
 * be reconstructed from anything on screen. It also had no `defaultValue` at all before #780:
 * it rendered blank on every refusal by construction, not by accident.
 */
import { expect, resetAndSeed, signInAsCrew, test } from "./fixtures.js";

test.describe("a refused save on /crew/time (#780)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("keeps the corrected times and the reason the crew member typed", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time");

    // A closed punch to edit, made the way a crew member makes one.
    await page.getByRole("button", { name: "Clock in" }).click();
    await page.waitForURL(/in=1/);
    await page.getByRole("button", { name: "Clock out" }).click();
    await page.waitForURL(/out=1/);

    // Open that row's editor. One editor at a time, keyed to `?edit=<id>` — tapping the row is
    // how a crew member gets here.
    await page.locator('a[href*="edit=punch-"]').first().click();
    await page.waitForURL(/edit=punch-/);

    // The refusal: an out time before the in time. Both set explicitly rather than nudged off
    // the clocked values, so the trigger doesn't depend on what time the suite happens to run —
    // 00:02/00:01 are in the past on any run after the first two minutes of a vessel-local day,
    // which is the one window this would misfire in (as `future` instead of `out_before_in`).
    await page.locator('input[name="inTime"]').fill("00:02");
    await page.locator('input[name="outTime"]').fill("00:01");
    await page.locator('input[name="reason"]').fill("Forgot to clock out after the sunset run");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/end the punch before it started/)).toBeVisible();

    // The reason is the assertion that matters. It is required, it is prose, and nothing on the
    // page can reconstruct it — before #780 this input had no `defaultValue` at all, so it came
    // back empty every single time and the crew member retyped it to fix a time field.
    await expect(page.locator('input[name="reason"]')).toHaveValue(
      "Forgot to clock out after the sunset run",
    );
    await expect(page.locator('input[name="inTime"]')).toHaveValue("00:02");
    await expect(page.locator('input[name="outTime"]')).toHaveValue("00:01");
  });

  test("keeps a refused NEW punch, which is a different form on the same page", async ({
    page,
  }) => {
    // Add and edit share one component but not one refusal path: an add comes back on
    // `?add=1&err=`, an edit on `?edit=<id>&err=`. A draft that only knew about one of them
    // would look fixed on whichever the first test happened to cover.
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time?add=1");

    await page.locator('input[name="inTime"]').fill("00:02");
    await page.locator('input[name="outTime"]').fill("00:01");
    await page.locator('input[name="reason"]').fill("Worked the private charter, never punched");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/end the punch before it started/)).toBeVisible();
    await expect(page.locator('input[name="reason"]')).toHaveValue(
      "Worked the private charter, never punched",
    );
    await expect(page.locator('input[name="outTime"]')).toHaveValue("00:01");
  });
});

/** A day comfortably in the future — time off can't be booked backwards. */
function daysFromToday(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test.describe("a refused save on /crew/time-off (#780)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("keeps both dates when the range is refused", async ({ page }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time-off");

    // Server-only: both fields are `required` and both hold real dates, so HTML validation is
    // satisfied and only the domain can object (`end_before_start`).
    const start = daysFromToday(20);
    const end = daysFromToday(10);
    await page.locator("#start").fill(start);
    await page.locator("#end").fill(end);
    await page.getByRole("button", { name: /Add/ }).click();

    await expect(page.getByText(/end date is before the start/)).toBeVisible();

    // Two date pickers is not much typing, but it is two pickers — and the surface had no
    // restore at all, so a refusal sent you back to an empty form to re-choose both.
    await expect(page.locator("#start")).toHaveValue(start);
    await expect(page.locator("#end")).toHaveValue(end);
  });
});
