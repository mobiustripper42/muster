/**
 * Imported Xola trips, on the operator's calendar and in the customer funnel.
 *
 * **This file exists because none of it was covered.** The suite had no `source='xola'` data at
 * all, so in one session three separate regressions reached the operator instead of a red build:
 * the sell funnel ignoring imported bookings (#615), the calendar drawing every occupied hull as
 * free, and imported trips rendered as anonymous "Booked" blocks with no customer name.
 *
 * Every assertion below maps to one of those. Seeds `reservation` (the live offering) then `xola`
 * (the synthetic import) — the interaction between the two is the subject.
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";
import { xolaFixture } from "../src/reservations/seed-xola.js";
import { TODAY } from "./reservation-demo.js";

const FX = xolaFixture(TODAY);
/** The demo cruise. Named explicitly because the fixture adds a SECOND live offering, so `/book`
 *  opens on the picker rather than straight into the only one. */
const DEMO_OFFERING = "offering-reservation-demo";
const bookHref = (date: string) => `/book?offering=${DEMO_OFFERING}&date=${date}`;

test.describe("imported Xola trips", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation", "xola");
  });

  test("the calendar draws an imported trip with its customer's name (#615)", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${FX.days.onGrid}`);

    // The regression this catches: the card read the literal word "Booked" with no customer,
    // because the reservation index was Muster-only and never found a Xola trip's reservation.
    const block = page.getByTestId("cal-block").filter({ hasText: "Priya Raman" });
    await expect(block).toBeVisible();
    await expect(block).toContainText("Xola");
  });

  test("a hull taken by an import does NOT read as open (#615)", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${FX.days.onGrid}`);

    // The worse regression: renaming the status made every occupied hull fall through to the
    // "open" card, so the whole fleet read free while charters were on the water.
    const openAt1330 = page.getByTestId("cal-block").filter({ hasText: "open · 1:30" });
    await expect(openAt1330).toHaveCount(0);
  });

  test("an overlapping import takes out departures it does not sit on (#691)", async ({ page }) => {
    // 14:00 + 100min covers 15:30, and 13:30 + 100 reaches into it. Neither is the trip's own
    // slot identity — the shape the exact-triple guard could not see.
    await page.goto(bookHref(FX.days.overlapping));

    await expect(page.getByTestId("slot-13:30")).toContainText("Sold out");
    await expect(page.getByTestId("slot-15:30")).toContainText("Sold out");
    await expect(page.getByTestId("slot-17:30")).not.toContainText("Sold out");
  });

  test("the clean day sells normally — the control", async ({ page }) => {
    // Without this, every assertion above could pass on a page that shows nothing bookable ever.
    await page.goto(bookHref(FX.days.clean));
    await expect(page.getByTestId("slot-13:30")).not.toContainText("Sold out");
    await expect(page.getByTestId("slot-15:30")).not.toContainText("Sold out");
  });

  test("a cancelled import releases the boat", async ({ page }) => {
    await page.goto(bookHref(FX.days.cancelled));
    // 15:30 carries a CANCELLED import and two live trips that leave it in a gap.
    await expect(page.getByTestId("slot-15:30")).not.toContainText("Sold out");
    await expect(page.getByTestId("slot-13:30")).toContainText("Sold out"); // the live one still blocks
  });

  test("the Booked badge counts exactly the cards on the board", async ({ page }) => {
    // The badge and the grid used to be computed from two different lists — one deduped, one
    // not — so on the very day this fixture exercises (one boat sold by two offerings) the
    // count read one higher than the cards. Nothing asserted the badge, so it shipped green.
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${FX.days.onGrid}`);

    const badge = await page.getByRole("link", { name: /^Booked/ }).innerText();
    const claimed = Number(badge.replace(/\D+/g, ""));
    const drawn = await page.getByTestId("cal-block").filter({ hasText: /Xola|·/ }).count();
    expect(claimed).toBeGreaterThan(0);

    await page.goto(`/admin/calendar?date=${FX.days.onGrid}&filter=booked`);
    expect(await page.getByTestId("cal-block").count()).toBe(claimed);
    expect(drawn).toBeGreaterThan(0);
  });

  test("one physical trip draws one card, not one per offering", async ({ page }) => {
    // Brew 3 is sold by more than one offering in this world, so a single trip produced a card
    // per offering — stacked, same customer's name twice.
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${FX.days.onGrid}`);
    await expect(page.getByTestId("cal-block").filter({ hasText: "Priya Raman" })).toHaveCount(1);
  });
});
