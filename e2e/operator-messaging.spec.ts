/**
 * Operator messaging surface (#118, §10) end-to-end over the real admin routes +
 * DB + session + server action.
 *
 *  1. Operator broadcasts to all-staff (with priority) → it lands as the office.
 *  2. Cross-visibility (DEC-052): a crew-created thread shows in the operator's
 *     list and opens for them.
 *
 * The operator authorization / mine-is-the-office / DM-visibility logic is
 * unit-tested (thread-view + operator-threads specs); this proves the wiring.
 */
import { test, expect, resetAndSeed, signInAsCrew, signInAsAdmin } from "./fixtures.js";

test.describe("operator messaging", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("operator broadcasts to all-staff, with priority, as the office", async ({ page }) => {
    await signInAsAdmin(page, "spink");

    await page.goto("/admin/messages");
    await expect(page.getByRole("link", { name: /All staff/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Today’s crew/ })).toBeVisible();

    await page.getByRole("link", { name: /All staff/ }).click();
    await page.waitForURL(/\/admin\/messages\/.+/);

    const body = "Crew — dock is slip B today, call 12:30";
    await page.getByRole("textbox").fill(body);
    await page.getByRole("checkbox", { name: /Priority/ }).check();
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(body)).toBeVisible();
    await expect(page.getByText("You (office)")).toBeVisible();
    await expect(page.getByText("· Priority")).toBeVisible(); // the bubble marker, not the checkbox label
  });

  test("Cohort button on the cockpit → posts to the day's cohort, prefixed 'Cohort' (#317)", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    // shift-soon is ~15 days out (not today) — proves the un-gated any-day cohort.
    await page.goto("/admin/shift/shift-soon");
    await page.getByRole("link", { name: /Message this day.s crew/ }).click();
    await page.waitForURL(/\/admin\/messages\/thread-cohort-/);

    await page.getByRole("textbox").fill("dock is slip B, call 12:30");
    await page.getByRole("button", { name: "Send" }).click();

    // Stored + rendered body LEADS with "Cohort —", posted as the office.
    await expect(page.getByText("Cohort — dock is slip B, call 12:30")).toBeVisible();
    await expect(page.getByText("You (office)")).toBeVisible();
  });

  test("operator sees a crew-created thread (cross-visibility)", async ({ page }) => {
    // Crew posts into their shift thread first.
    await signInAsCrew(page, "crew-quint");
    const people = page.getByRole("navigation", { name: "Admin" }).locator("summary").filter({ hasText: "People" });
    if (await people.isVisible()) await people.click(); // Messages is under People ▾ (#603)
    await page.getByRole("link", { name: "Messages" }).click();
    await page.waitForURL(/\/crew\/threads$/); // else /Hops/ races the My-shifts card on home
    await page.getByRole("link", { name: /Hops/ }).click();
    await page.waitForURL(/\/crew\/threads\/.+/);
    await page.getByRole("textbox").fill("running five late");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("running five late")).toBeVisible();

    // Operator (a different subject) now sees that thread and its message.
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/messages");
    const hops = page.getByRole("link", { name: /Hops/ });
    await expect(hops).toBeVisible();
    await expect(hops).toContainText("running five late");
    await hops.click();
    await expect(page.getByText("running five late")).toBeVisible();
  });
});
