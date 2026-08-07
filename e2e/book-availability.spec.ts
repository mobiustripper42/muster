/**
 * Customer availability screen (task 12.4, #457) — drives the public `/book` "Date & time" page.
 *
 * Uses the `reservation` seed: one LIVE offering ("Reservation Demo Cruise") on Brew 3 (cap 12,
 * no includedGuestCount ⇒ included = cap), base $499, $50/extra guest, owned the 10th–16th of
 * NEXT month with departures 13:30/15:30/17:30 and one booking at 13:30 on the 12th (Marcus
 * Webb). So on that day the 13:30 slot is SOLD OUT and 15:30/17:30 are the last boat each.
 *
 * **Dates are derived, never typed (#646).** They were literal (Aug 2026) until today caught up
 * to them, at which point `/book`'s default month WAS the seeded month and the paging test below
 * had nowhere to page — and passed anyway by racing a navigation. `e2e/reservation-demo.ts`
 * computes what the seed computed.
 *
 * Runs desktop + 375px (registered in the mobile testMatch): the one screen, two native layouts.
 */
import { test, expect, resetAndSeed, clickHydrated } from "./fixtures.js";
import { BOOKED, DEMO_MONTH_LABEL, TODAY_MONTH_LABEL } from "./reservation-demo.js";

/** The seeded booked day — 13:30 sold out, 15:30/17:30 open. */
const BOOKED_DAY = `/book?date=${BOOKED.date}`;

test.describe("public /book availability", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("renders the offering, calendar, and honest whole-boat slots", async ({ page }) => {
    await page.goto(BOOKED_DAY);

    // Hero + secure header (the offering is the sole live one, so it opens straight in).
    await expect(page.getByRole("heading", { name: "Reservation Demo Cruise", level: 1 })).toBeVisible();
    await expect(page.getByText("Book a cruise")).toBeVisible();
    await expect(page.getByText(DEMO_MONTH_LABEL)).toBeVisible();

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
    expect(href).toContain(`date=${BOOKED.date}`);
    expect(href).toContain("time=15"); // first available slot (13:30 is booked), colon-encoded
    expect(href).toContain("guests=2");
  });

  test("the guest stepper is a live client island", async ({ page }) => {
    await page.goto(BOOKED_DAY);

    const count = page.getByTestId("guest-count");
    await expect(count).toHaveText("2");

    await clickHydrated(page.getByRole("button", { name: "More guests" }));
    await expect(count).toHaveText("3");

    // The Continue href updates client-side with the new count — no navigation.
    await expect(page.getByTestId("continue")).toHaveAttribute("href", /guests=3/);
    await expect(page).toHaveURL(new RegExp(`date=${BOOKED.date}`)); // still the same server render

    // The stepper floors at one guest.
    const fewer = page.getByRole("button", { name: "Fewer guests" });
    await clickHydrated(fewer); // 3 → 2
    await fewer.click(); // 2 → 1
    await expect(count).toHaveText("1");
    await expect(fewer).toBeDisabled();
  });

  test("an empty month prompts a date pick and pages forward to availability", async ({ page }) => {
    await page.goto("/book"); // defaults to today's month — the seeded window is next month

    // The premise, asserted rather than assumed: we start on today's month, and it is a
    // DIFFERENT month from the seeded one. The old version of this test took both on faith and
    // silently stopped testing anything the day they stopped being true.
    expect(TODAY_MONTH_LABEL).not.toBe(DEMO_MONTH_LABEL);
    await expect(page.getByText(TODAY_MONTH_LABEL)).toBeVisible();
    await expect(page.getByText("Pick an available date to see start times.")).toBeVisible();

    // Page forward, WAITING for each navigation. The previous loop polled immediately after the
    // click, so it usually read the pre-navigation page, broke out on iteration 0 and asserted
    // against the month it never left — passing while verifying nothing (#646). `waitForURL` is
    // what makes each iteration real.
    let paged = 0;
    for (let i = 0; i < 6; i++) {
      if (await page.getByText(DEMO_MONTH_LABEL).isVisible().catch(() => false)) break;
      const before = page.url();
      await page.getByRole("link", { name: "Next month" }).click();
      await page.waitForURL((u) => u.toString() !== before);
      paged++;
    }

    await expect(page.getByText(DEMO_MONTH_LABEL)).toBeVisible();
    // The seeded window is exactly one month ahead, so reaching it must have cost exactly one
    // page. Pinning the count is what stops this passing without paging: a test that breaks out
    // on iteration 0 and happens to be looking at the right month would still be a lie.
    expect(paged).toBe(1);
    // …and the month we paged to actually has bookable days, which is the point of going there.
    await expect(page.getByRole("link", { name: /^\d+$/ }).first()).toBeVisible();
  });

  test("picking a slot keeps your place on the page", async ({ page }) => {
    // Every internal nav here is a force-dynamic server round-trip, and next/link's default
    // scroll={true} yanks you back to the hero on each one — so choosing a time on a phone
    // means scrolling back down to see what you chose. Reported by the operator, 2026-08-06.
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(BOOKED_DAY);

    const slot = page.getByTestId("slot-17:30");
    await slot.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    expect(before, "the slot list must be below the fold, or this test proves nothing").toBeGreaterThan(0);

    await slot.click();
    await page.waitForURL(/time=17%3A30|time=17:30/);
    await expect(page.getByTestId("slot-17:30")).toBeVisible();

    const after = await page.evaluate(() => window.scrollY);
    expect(after, "navigation scrolled back to the top").toBeGreaterThan(0);
  });
});
