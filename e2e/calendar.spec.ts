/**
 * Day·Grid reservation calendar (task 12.11, #464) — drives /admin/calendar end to end.
 * Read-only slice: one day as fleet-vessel columns × a fixed 8:00–21:30 axis, each computed
 * departure a duration-spanning block (deriveVirtualAvailability, DEC-125).
 *
 * The `reservation` seed builds a LIVE offering + owned days (Aug 10–16) on Brew 3 with two
 * booked trips (RESERVATION_DEMO): Aug 12 13:30 Marcus Webb (party 8), Aug 13 15:30 Dana Cho.
 * So on 2026-08-12 Brew 3 shows one BOOKED block (Marcus Webb) + two OPEN blocks (15:30, 17:30
 * — the offering's other departures). The Booked filter hides the opens, keeps the booking.
 * Runs desktop + 375px (the grid scrolls; the booked block stays present).
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";

test.describe("admin /admin/calendar", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation"); // live offering + owned days + 2 booked trips on Brew 3
  });

  test("Day·Grid renders the day; Booked filter hides opens", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/calendar?date=2026-08-12");

    // Brew 3 has a column header.
    await expect(page.getByText("Brew 3", { exact: true })).toBeVisible();

    // The 13:30 booking renders as a booked block: customer + "1:30 · 8".
    const booked = page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" });
    await expect(booked).toBeVisible();
    await expect(booked).toContainText("1:30");
    await expect(booked).toContainText("8");

    // The offering's other two departures show as OPEN blocks (15:30, 17:30).
    await expect(page.getByText("open · 3:30")).toBeVisible();
    await expect(page.getByText("open · 5:30")).toBeVisible();

    // Filter → Booked: opens vanish, the booking stays.
    await page.getByTestId("filter-booked").click();
    await page.waitForURL(/filter=booked/);
    await expect(page.getByText("open · 3:30")).toHaveCount(0);
    await expect(page.getByText("open · 5:30")).toHaveCount(0);
    await expect(page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" })).toBeVisible();
  });

  /**
   * The detail pane (12.11 continued) — read-only, NO actions in this slice. The seeded
   * booking carries no payments and no gratuities, so the money block is the pure derivation:
   * fare 54900 (the event's price; the seed freezes no extras) + 7.25% tax = 3980 ⇒ a 58880
   * balance still due, nothing paid. No gratuity section renders at all.
   */
  test("a booked block opens its reservation detail; money derives from fare + tax", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/calendar?date=2026-08-12");

    await page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" }).click();
    await page.waitForURL(/\/admin\/calendar\/resv-demo/);

    const pane = page.getByTestId("reservation-detail");
    await expect(pane).toBeVisible();
    // The page heading names the reservation; the pane deliberately doesn't repeat it.
    await expect(page.getByRole("heading", { name: "Marcus Webb", level: 1 })).toBeVisible();

    // Guests against the boat's COI cap — "8 of 12", never a seat count.
    await expect(pane).toContainText("8");
    await expect(pane).toContainText("of 12");

    // The three rows the model can't source the mockup's way.
    await expect(pane).toContainText("Waiver");
    await expect(pane).toContainText("Not on file"); // one consent record, not "7 of 7"
    await expect(pane).toContainText("Updated"); // updatedAt, never "Booked"
    await expect(pane).not.toContainText("Add-on"); // no per-reservation add-ons exist

    // Money: fare + tax, nothing paid, balance still due. No service fee (Xola's, unmodelled).
    await expect(pane).toContainText("$549.00");
    await expect(pane).toContainText("$39.80");
    await expect(pane).toContainText("$588.80");
    await expect(pane).not.toContainText("Service fee");

    // Read-only slice — none of the mockup's action buttons ship yet.
    await expect(pane.getByRole("button")).toHaveCount(0);
    await expect(pane).not.toContainText("Refund");
    await expect(pane).not.toContainText("Cancel");

    // One route, two native layouts (no client JS): the grid sits BESIDE the pane on desktop
    // and is hidden on mobile, where the pane is the whole page. It's hidden rather than
    // omitted because a server render can't know the viewport — the markup ships either way.
    const grid = page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" });
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    if (wide) await expect(grid).toBeVisible();
    else await expect(grid).toBeHidden();

    // Back returns to the day you came from.
    await page.getByRole("link", { name: "Back to calendar" }).click();
    await page.waitForURL(/\/admin\/calendar\?date=2026-08-12/);
    await expect(page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" })).toBeVisible();
  });

  /** A direct link with no ?date must land on the reservation's OWN day, not today's grid. */
  test("deep link with no date resolves the reservation's own day", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/calendar/resv-demo-2026-08-13-15:30");

    const pane = page.getByTestId("reservation-detail");
    await expect(page.getByRole("heading", { name: "Dana Cho", level: 1 })).toBeVisible();
    await expect(pane).toContainText("Aug 13");
    await expect(pane).toContainText("3:30 PM");
    // Dana's fare is 43900 → tax 3183 → 47083 due.
    await expect(pane).toContainText("$439.00");
    await expect(pane).toContainText("$470.83");
  });

  test("an unknown reservation 404s rather than rendering an empty pane", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    const res = await page.goto("/admin/calendar/resv-does-not-exist");
    expect(res?.status()).toBe(404);
  });
});
