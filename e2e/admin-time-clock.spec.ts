/**
 * The repair bench (#627, SPEC §2.9.5): the operator closes what the clock got wrong.
 * Domain doors and both view models are unit-tested; here we drive the SURFACE — the
 * two views, the stale-open strip, and the four writes.
 * Runs desktop + 375px.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

/**
 * Move the bench to the PREVIOUS pay period, so every day in it is already past.
 *
 * The add tests below enter 09:00–17:00 on the period's first day. That day is usually behind
 * us — but on day 1 of a period it IS today, and the domain's no-future-punch guard then refuses
 * the 17:00 out with `err=future`. So these specs failed for roughly one day in fourteen, before
 * 5pm, which is a nastier shape than failing outright: the suite is green thirteen days running
 * and then red for reasons that look unrelated to whatever shipped that morning.
 *
 * Selecting a past period removes the class rather than patching each entry, and needs no clock
 * arithmetic in the spec. Found on 2026-08-03, which happened to be a period's first day.
 */
async function usePreviousPeriod(page: import("@playwright/test").Page): Promise<void> {
  const select = page.getByLabel("Pay period");
  const values = await select
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  const current = await select.inputValue();
  const i = values.indexOf(current);
  expect(i, "the current period must be in the list").toBeGreaterThan(0);
  await select.selectOption(values[i - 1]!);
  await page.waitForURL(/period=/);
}

test.describe("admin /admin/time-clock — the repair bench", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("the People nav carries Time clock, distinct from Time off", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/time-clock");
    await expect(page.getByRole("heading", { name: "Time clock" })).toBeVisible();
  });

  test("add a punch, correct it, then delete it", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/time-clock");
    await usePreviousPeriod(page);

    // Add: crew view, so the person is fixed and we pick a day. The day is READ FROM
    // THE PAGE (the input's own `min` = the selected period's first day) rather than
    // hardcoded — a fixed date rots the moment the calendar passes it, which is
    // exactly how e2e/book-availability.spec.ts broke.
    const addDay = await page.locator("#add-day").getAttribute("min");
    await page.locator("#add-day").fill(addDay!);
    await page.locator("#add-in").fill("09:00");
    await page.locator("#add-out").fill("17:00");
    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL(/added=1/);
    await expect(page.getByText("Punch added.")).toBeVisible();
    // Twice on purpose: the punch row AND the period total, which is the stronger
    // assertion — the punch rendered and the total picked it up.
    await expect(page.getByText("8h")).toHaveCount(2);
    // Provenance is visible immediately (§2.9.8).
    // exact — the add form's help text also mentions being marked as entered by
    // the office, and that sentence is not the provenance badge.
    await expect(page.getByText("Entered by the office", { exact: true })).toBeVisible();

    // Correct the out time on the punch card (the first Save form).
    const card = page.locator("form", { has: page.getByRole("button", { name: "Save" }) }).first();
    await card.locator('input[name="outTime"]').fill("18:30");
    await card.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/saved=1/);
    await expect(page.getByText("9h 30m")).toHaveCount(2);

    // Delete, behind the disclosure — the warning is reachable before the button.
    // The disclosure is the confirmation step — opening it is the deliberate act,
    // and the explanatory sentence was cut as redundant (operator, 2026-08-01).
    await page.getByText("Delete this punch").click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.waitForURL(/deleted=1/);
    await expect(page.getByText("No punches here.")).toBeVisible();
  });

  test("an out time before the in time is refused with copy, not a 500", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/time-clock");
    await usePreviousPeriod(page);

    const addDay = await page.locator("#add-day").getAttribute("min");
    await page.locator("#add-day").fill(addDay!);
    await page.locator("#add-in").fill("17:00");
    await page.locator("#add-out").fill("09:00");
    await page.getByRole("button", { name: "Add" }).click();

    await page.waitForURL(/err=out_before_in/);
    await expect(page.getByText(/can’t end before it starts/)).toBeVisible();
    await expect(page.getByText("No punches here.")).toBeVisible(); // nothing written
    // A refusal must not cost the operator everything they typed — the attempted
    // values come back in the form so only the wrong field needs fixing.
    await expect(page.locator("#add-in")).toHaveValue("17:00");
    await expect(page.locator("#add-out")).toHaveValue("09:00");
    await expect(page.locator("#add-day")).toHaveValue(addDay!);
  });

  test("an overnight punch — in at 10pm, out at 2am the next day — is one punch", async ({
    page,
  }) => {
    // The case the action layer originally couldn't express at all: both times were
    // resolved against the SAME day, so 22:00 → 02:00 came back `out_before_in` and a
    // night shift was unrecordable. "Out is next day" is explicit rather than inferred
    // from out < in, so a typo stays an error instead of becoming a paid 16 hours.
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/time-clock");
    await usePreviousPeriod(page);
    const addDay = await page.locator("#add-day").getAttribute("min");
    await page.locator("#add-day").fill(addDay!);
    await page.locator("#add-in").fill("22:00");
    await page.locator("#add-out").fill("02:00");
    await page.locator('input[name="outNextDay"]').last().check();
    await page.getByRole("button", { name: "Add" }).click();

    await page.waitForURL(/added=1/);
    // Four hours, on the day it STARTED — not two days, not a rejection.
    await expect(page.getByText("4h")).toHaveCount(2); // the row and the total
    // And the row comes back with its next-day box already ticked.
    await expect(page.locator('input[name="outNextDay"]').first()).toBeChecked();
  });

  test("without the next-day box, an out before the in is still refused", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/time-clock");
    await usePreviousPeriod(page);
    const addDay = await page.locator("#add-day").getAttribute("min");
    await page.locator("#add-day").fill(addDay!);
    await page.locator("#add-in").fill("22:00");
    await page.locator("#add-out").fill("02:00");
    await page.getByRole("button", { name: "Add" }).click();

    await page.waitForURL(/err=out_before_in/);
    await expect(page.getByText("No punches here.")).toBeVisible();
  });

  test("the day view's date picker actually navigates, and ‹ › keep it in sync", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/time-clock");
    await page.getByRole("link", { name: "By day" }).click();
    await page.waitForURL(/day=/);

    const start = await page.locator("#day").inputValue();
    // Picking a date navigates on its own — there is no View button to press.
    await page.locator("#day").fill("2026-07-04");
    await page.waitForURL(/day=2026-07-04/);
    await expect(page.locator("#day")).toHaveValue("2026-07-04");

    // Stepping updates the picker too — an uncontrolled input keeps its mount-time
    // value through a client-side nav unless it's remounted.
    await page.getByRole("link", { name: "Next day" }).click();
    await page.waitForURL(/day=2026-07-05/);
    await expect(page.locator("#day")).toHaveValue("2026-07-05");

    await page.getByRole("link", { name: "Previous day" }).click();
    await page.waitForURL(/day=2026-07-04/);
    await expect(page.locator("#day")).toHaveValue("2026-07-04");
    expect(start).not.toBe("2026-07-04"); // the seed day really did move
  });

  test("an open punch from an earlier day surfaces in the strip and links to its day", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/time-clock");
    await usePreviousPeriod(page);

    // Leave one running on the period's first day. The strip only fires on an EARLIER day, and
    // this used to skip itself whenever the period had started today — which is exactly the day
    // the assertion was most worth making. On a PAST period every day qualifies, so it now runs
    // every time instead of quietly opting out one day in fourteen.
    const addDay = (await page.locator("#add-day").getAttribute("min"))!;
    await page.locator("#add-day").fill(addDay);
    await page.locator("#add-in").fill("09:00");
    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL(/added=1/);

    // The strip is independent of the pickers — it's there without choosing anything.
    await expect(page.getByText(/still open from an earlier day/)).toBeVisible();

    // And it links to the day view that fixes it.
    await page.getByRole("link", { name: /in at 9:00 AM on/ }).click();
    await page.waitForURL(new RegExp(`day=${addDay}`));
    await expect(page.getByText(/· all crew/i)).toBeVisible();
  });

  test("signed out, the page refuses rather than rendering", async ({ page }) => {
    await page.goto("/admin/time-clock");
    await expect(page.getByRole("heading", { name: "Time clock" })).toHaveCount(0);
  });
});
