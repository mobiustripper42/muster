/**
 * Customer availability screen (task 12.4, #457) — drives the public `/book` "Date & time" page.
 *
 * Uses the `reservation` seed: one LIVE offering ("Reservation Demo Cruise") on Brew 3 (cap 12,
 * no includedGuestCount ⇒ included = cap), base $499, $50/extra guest, owned Aug 10–16 2026 with
 * departures 13:30/15:30/17:30 and one booking on Aug 12 13:30 (Marcus Webb). So on 2026-08-12
 * the 13:30 slot is SOLD OUT and 15:30/17:30 are the last boat each. The seed's dates sit in the
 * future relative to the test clock, so the default (today's month) has no availability — the
 * calendar pages forward to August.
 *
 * Runs desktop + 375px (registered in the mobile testMatch): the one screen, two native layouts.
 */
import { test, expect, resetAndSeed, clickHydrated } from "./fixtures.js";

const AUG12 = "/book?date=2026-08-12";

test.describe("public /book availability", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("renders the offering, calendar, and honest whole-boat slots", async ({ page }) => {
    await page.goto(AUG12);

    // Hero + secure header (the offering is the sole live one, so it opens straight in).
    await expect(page.getByRole("heading", { name: "Reservation Demo Cruise", level: 1 })).toBeVisible();
    await expect(page.getByText("Book a cruise")).toBeVisible();
    await expect(page.getByText("August 2026")).toBeVisible();

    // The booked 13:30 is sold out; the other two are the last boat, priced from the base ($499).
    await expect(page.getByTestId("slot-13:30")).toContainText("Sold out");
    const slot1530 = page.getByTestId("slot-15:30");
    await expect(slot1530).toContainText("1 boat left");
    await expect(slot1530).toContainText("$499.00");
    await expect(page.getByTestId("slot-17:30")).toContainText("1 boat left");

    // Footer: live total for the default 2 guests (base only — no extras below the included 12),
    // and Continue carries date + time + guests to checkout (12.5).
    await expect(page.getByText("$499.00").first()).toBeVisible();
    const cont = page.getByTestId("continue");
    await expect(cont).toBeVisible();
    const href = await cont.getAttribute("href");
    expect(href).toContain("date=2026-08-12");
    expect(href).toContain("time=15"); // first available slot (13:30 is booked), colon-encoded
    expect(href).toContain("guests=2");
  });

  test("the guest stepper is a live client island", async ({ page }) => {
    await page.goto(AUG12);

    const count = page.getByTestId("guest-count");
    await expect(count).toHaveText("2");

    await clickHydrated(page.getByRole("button", { name: "More guests" }));
    await expect(count).toHaveText("3");

    // The Continue href updates client-side with the new count — no navigation.
    await expect(page.getByTestId("continue")).toHaveAttribute("href", /guests=3/);
    await expect(page).toHaveURL(/date=2026-08-12/); // still the same server render

    // The stepper floors at one guest.
    const fewer = page.getByRole("button", { name: "Fewer guests" });
    await clickHydrated(fewer); // 3 → 2
    await fewer.click(); // 2 → 1
    await expect(count).toHaveText("1");
    await expect(fewer).toBeDisabled();
  });

  test("an empty month prompts a date pick and pages forward to availability", async ({ page }) => {
    await page.goto("/book"); // defaults to today's month — before the seeded August window

    await expect(page.getByText(/2026/)).toBeVisible(); // the current month label
    await expect(page.getByText("Pick an available date to see start times.")).toBeVisible();

    // Paging to the seeded month surfaces the calendar there.
    await page.getByRole("link", { name: "Next month" }).click();
    // Repeat until August (the seed is a fixed calendar month or two out).
    for (let i = 0; i < 6; i++) {
      if (await page.getByText("August 2026").isVisible().catch(() => false)) break;
      await page.getByRole("link", { name: "Next month" }).click();
    }
    await expect(page.getByText("August 2026")).toBeVisible();
  });
});
