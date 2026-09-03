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
    await signInAsAdmin(page, "eric");
    await page.goto(`/admin/calendar?date=${FX.days.onGrid}`);

    // The regression this catches: the card read the literal word "Booked" with no customer,
    // because the reservation index was Muster-only and never found a Xola trip's reservation.
    const block = page.getByTestId("cal-block").filter({ hasText: "Priya Raman" });
    await expect(block).toBeVisible();
    await expect(block).toContainText("Xola");
  });

  test("a hull taken by an import does NOT read as open (#615)", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto(`/admin/calendar?date=${FX.days.onGrid}`);

    // The worse regression: renaming the status made every occupied hull fall through to the
    // "open" card, so the whole fleet read free while charters were on the water.
    //
    // Scoped to Brew 3 on purpose. The fleet offering puts a 1:30 departure on all four boats and
    // only Brew 3 carries the import, so a page-wide assertion would fail on three boats that are
    // correctly open — and "no open cards anywhere" would be the wrong thing to want.
    const brew3 = page.locator('[data-testid="cal-block"][data-vessel="vessel-brew-3"]');
    await expect(brew3.filter({ hasText: "open · 1:30" })).toHaveCount(0);
    // …while the boats with no import that hour DO read open. Without this the assertion above
    // would still pass on a calendar that had stopped drawing open slots entirely.
    //
    // Deliberately not an exact count. Brew 1 joined the demo offering in #715 and the fleet
    // offering already sold it at 1:30, so two offerings now draw an open card on one hull —
    // that is issue #702, stacked open slots, and it is not this test's subject. Pinning the
    // number here would make a bug's current symptom load-bearing for an unrelated regression
    // test, and #702's fix would redden the wrong file.
    const brew1 = page.locator('[data-testid="cal-block"][data-vessel="vessel-brew-1"]');
    await expect(brew1.filter({ hasText: "open · 1:30" })).not.toHaveCount(0);
  });

  /**
   * **Read as "Brew 3 left the funnel", not "the day sold out".** The demo offering carried one
   * boat when this file was written, so an import on Brew 3 emptied its departures outright and
   * the assertion could be the word "Sold out". #715 attached Brew 1 and Brew 2 to that offering,
   * so the same import now removes ONE hull of three. The subject is unchanged — an occupied hull
   * must not be advertised — and the boat count is a sharper signal than the sold-out word ever
   * was: it fails if the import removes nothing AND if it removes too much.
   */
  test("an overlapping import takes out departures it does not sit on (#691)", async ({ page }) => {
    // 14:00 + 100min covers 15:30, and 13:30 + 100 reaches into it. Neither is the trip's own
    // slot identity — the shape the exact-triple guard could not see.
    await page.goto(bookHref(FX.days.overlapping));

    await expect(page.getByTestId("slot-13:30")).toContainText("2 boats open");
    await expect(page.getByTestId("slot-15:30")).toContainText("2 boats open");
    await expect(page.getByTestId("slot-17:30")).toContainText("3 boats open");
  });

  test("the clean day sells normally — the control", async ({ page }) => {
    // Without this, every assertion above could pass on a page that shows nothing bookable ever.
    await page.goto(bookHref(FX.days.clean));
    await expect(page.getByTestId("slot-13:30")).toContainText("3 boats open");
    await expect(page.getByTestId("slot-15:30")).toContainText("3 boats open");
  });

  test("a cancelled import releases the boat", async ({ page }) => {
    await page.goto(bookHref(FX.days.cancelled));
    // 15:30 carries a CANCELLED import and two live trips that leave it in a gap — all three
    // hulls are sellable there.
    await expect(page.getByTestId("slot-15:30")).toContainText("3 boats open");
    await expect(page.getByTestId("slot-13:30")).toContainText("2 boats open"); // the live one still blocks
  });

  test("the Booked badge counts exactly the cards on the board", async ({ page }) => {
    // The badge and the grid used to be computed from two different lists — one deduped, one
    // not — so on the very day this fixture exercises (one boat sold by two offerings) the
    // count read one higher than the cards. Nothing asserted the badge, so it shipped green.
    await signInAsAdmin(page, "eric");
    await page.goto(`/admin/calendar?date=${FX.days.onGrid}`);

    const badge = await page.getByRole("link", { name: /^Booked/ }).innerText();
    const claimed = Number(badge.replace(/\D+/g, ""));
    const drawn = await page.getByTestId("cal-block").filter({ hasText: /Xola|·/ }).count();
    expect(claimed).toBeGreaterThan(0);

    await page.goto(`/admin/calendar?date=${FX.days.onGrid}&filter=booked`);
    expect(await page.getByTestId("cal-block").count()).toBe(claimed);
    expect(drawn).toBeGreaterThan(0);
  });

  test("an imported trip opens its detail — it is a reservation on the operator's boat", async ({
    page,
  }) => {
    // Xola cards were inert: the reservation index was Muster-only, so the card took the
    // non-link branch. During coexistence most cards are imported, which made most of the
    // calendar dead to the touch.
    await signInAsAdmin(page, "eric");
    await page.goto(`/admin/calendar?date=${FX.days.onGrid}`);

    await page.getByTestId("cal-block").filter({ hasText: "Priya Raman" }).click();

    await expect(page).toHaveURL(/\/admin\/calendar\/resv-xola-/);
    await expect(page.getByText("Priya Raman").first()).toBeVisible();
  });

  test("the second offering's 14:00 overlaps the demo's 13:30 — two offerings, one hull (#691)", async ({
    page,
  }) => {
    // No import involved. 14:00 + 60min sits inside 13:30 + 100min, so on a day where 13:30 is
    // taken the 14:00 departure cannot run either — two slot identities, one boat.
    await page.goto(`/book?offering=offering-xola-fixture-second&date=${FX.days.onGrid}`);
    await expect(page.getByTestId("slot-14:00")).toContainText("Sold out");

    // …and on the clean day both are open, because two VIRTUAL slots do not block each other.
    // Whoever books first takes the other out; that is the real-world shape of #691.
    await page.goto(`/book?offering=offering-xola-fixture-second&date=${FX.days.clean}`);
    await expect(page.getByTestId("slot-14:00")).not.toContainText("Sold out");
  });

  test("one physical trip draws one card, not one per offering", async ({ page }) => {
    // Brew 3 is sold by more than one offering in this world, so a single trip produced a card
    // per offering — stacked, same customer's name twice.
    await signInAsAdmin(page, "eric");
    await page.goto(`/admin/calendar?date=${FX.days.onGrid}`);
    await expect(page.getByTestId("cal-block").filter({ hasText: "Priya Raman" })).toHaveCount(1);
  });
});
