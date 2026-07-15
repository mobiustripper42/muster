/**
 * "Other shifts today" (#315) — a crew member on a shift can expand a no-JS
 * `<details>` on their shift card to see the rest of the day: which other boats
 * are out, when they leave, and who's aboard. Comraderie + coordination; no
 * guests, no scoreboard. The crew seed puts a second boat (Growler, crewed by
 * Gilly, 1pm) on the same day as shift-soon.
 */
import { test, expect, resetAndSeed, signInAsCrew } from "./fixtures.js";

test.describe("crew shift card — other shifts today (#315)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("lists the day's other boats, departure times, and crew", async ({
    page,
  }) => {
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/shift/shift-soon");

    const section = page.locator("details", {
      has: page.getByText("Other shifts today"),
    });
    // Collapsed by default — the viewer's own shift is the headline.
    await expect(section).toBeVisible();
    await expect(section).not.toHaveAttribute("open", /.*/);
    // The count is in the summary before you even open it.
    await expect(section.getByText("Other shifts today")).toContainText("(1)");

    // Expand → the sibling Growler shift: boat, 1:00 PM departure, "2 trips", crew.
    await section.getByText("Other shifts today").click();
    await expect(section.getByText("Growler")).toBeVisible();
    await expect(section.getByText("1:00 PM")).toBeVisible();
    await expect(section.getByText("2 trips")).toBeVisible(); // multi-trip count (#315 follow-up)
    await expect(section.getByText("Gilly")).toBeVisible();

    // PII boundary: no guest manifest leaks into the other-shift row.
    await expect(section.getByText(/guest/i)).toHaveCount(0);
  });
});
