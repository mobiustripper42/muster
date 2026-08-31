/**
 * Customer availability screen (task 12.4, #457) — drives the public `/book` "Date & time" page.
 *
 * Uses the `reservation` seed: one LIVE offering ("Reservation Demo Cruise") on THREE boats —
 * Brew 3 (12), Brew 1 (14), Brew 2 (16), no includedGuestCount ⇒ included = the departure's cap
 * — base $499, $50/extra guest, **demo window** a seven-day stretch late in NEXT month, departures
 * 13:30/15:30/17:30, and one booking at 13:30 on its third day (Marcus Webb) which sits on Brew 3.
 * The exact days live in `reservationDemo`; read them from `DEMO`/`BOOKED` rather than from here.
 *
 * **The window is not the season any more (#797).** The season starts TODAY, so bookable slots
 * exist in the current month; only the bookings and the block fixtures live in the window above.
 * Read the two as separate things when a count here looks off.
 *
 * It does **not** break the forward-paging test below, which #797 claimed and issue #804 was filed
 * for. Both were wrong: that test's assertions turn on no-date-selected and on the month label,
 * never on the current month being empty. See its own comment.
 *
 * **The fixture gained its second and third boat in #715**, and it moved every count in this file:
 * a booking on Brew 3 no longer sells out its departure, it leaves two boats open. That is the
 * point — a single-hull offering makes the guest filter unobservable, because every party from 1
 * to 12 sees an identical calendar and a broken filter looks exactly like a working one.
 *
 * **Dates are derived, never typed (#646).** They were literal (Aug 2026) until today caught up
 * to them, at which point `/book`'s default month WAS the seeded month and the paging test below
 * had nowhere to page — and passed anyway by racing a navigation. `e2e/reservation-demo.ts`
 * computes what the seed computed.
 *
 * Runs desktop + 375px (registered in the mobile testMatch): the one screen, two native layouts.
 */
import { test, expect, resetAndSeed, clickHydrated, plantCheckoutHold, plantVesselBlock } from "./fixtures.js";
import { BOOKED, DEMO, DEMO_MONTH_LABEL, TODAY_MONTH_LABEL } from "./reservation-demo.js";

/** The fixture's sole live offering — the one `/book` opens straight into. */
const DEMO_OFFERING = "offering-reservation-demo";

/** The seeded booked day — Brew 3's 13:30 is taken, the other two boats are free all day. */
const BOOKED_DAY = `/book?date=${BOOKED.date}`;

/** The offering's boats, by cap. Read off the fixture so a seed change breaks the spec loudly
 *  rather than making it assert against boats that are no longer there. */
const SMALLEST = DEMO.fleet[0]!; // Brew 3, 12 — the stepper's default
const BIGGEST = DEMO.fleet[DEMO.fleet.length - 1]!; // Brew 2, 16 — the stepper's ceiling

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

    // Brew 3's 13:30 is booked, so that departure runs two boats short of the other two;
    // everything is priced from the base ($499) because all three hulls share it.
    await expect(page.getByTestId("slot-13:30")).toContainText("2 boats open");
    const slot1530 = page.getByTestId("slot-15:30");
    await expect(slot1530).toContainText("3 boats open");
    await expect(slot1530).toContainText("$499.00");
    await expect(page.getByTestId("slot-17:30")).toContainText("3 boats open");

    // Footer: live total for the default party — the SMALLEST boat's cap, so the customer lands
    // on the fullest calendar the offering can show. Continue carries date + time + guests (12.5).
    //
    // Pinned by testid and to the FULL total, not `getByText("$499.00").first()`. That matcher
    // was written when the base was the whole answer; the seed now includes 10 guests and charges
    // $40 a head beyond, so a party of 12 owes $499 + 2 × $40 — and the loose matcher would have
    // gone on passing by finding the base price in a slot row, testing the footer not at all.
    await expect(page.getByTestId("footer-total")).toHaveText("$579.00");
    await expect(page.getByTestId("guest-count")).toHaveText(String(SMALLEST.coiMaxPax));
    const cont = page.getByTestId("continue");
    await expect(cont).toBeVisible();
    const href = await cont.getAttribute("href");
    expect(href).toContain(`date=${BOOKED.date}`);
    expect(href).toContain("time=13"); // 13:30 still has two boats open, so it's first, not skipped
    expect(href).toContain(`guests=${SMALLEST.coiMaxPax}`);
  });

  /**
   * #715 — the whole point. Never show a customer something they cannot buy.
   *
   * A party of 15 fits only Brew 2 (16). The 13:30 that reads "2 boats open" to a party of 12 is
   * one boat to them, because one of those two is the 14. Before this, the count, the price and
   * the day were all quoted off the biggest hull in the fleet regardless of whether it was the
   * one still free — so the number on screen was true of a boat the customer could not have.
   */
  test("the party size filters the departures, and says so", async ({ page }) => {
    await page.goto(`${BOOKED_DAY}&guests=15`);

    // Brew 3 (12) is booked at 13:30 and too small anyway; Brew 1 (14) is free and too small;
    // only Brew 2 (16) is both free and big enough.
    await expect(page.getByTestId("slot-13:30")).toContainText("1 boat left");
    await expect(page.getByTestId("slot-15:30")).toContainText("1 boat left");

    // Drop to a party every hull takes and the same departures widen back out. Asserted in the
    // same test because "1 boat left" alone would also pass against a filter that removed boats
    // unconditionally.
    await page.goto(`${BOOKED_DAY}&guests=12`);
    await expect(page.getByTestId("slot-13:30")).toContainText("2 boats open");
    await expect(page.getByTestId("slot-15:30")).toContainText("3 boats open");
  });

  /**
   * The third calendar state (#715). A day whose boats are all free but all too small is neither
   * "sold out" nor "nothing runs" — and the customer cannot act on either of those answers.
   * Reachable only with the big boat out of service, which is why the block is planted here.
   */
  test("a day with no boat big enough reads too-big, not sold out", async ({ page }) => {
    await plantVesselBlock({
      id: "blk-715-bigboat",
      vesselId: BIGGEST.vesselId,
      startDate: BOOKED.date,
      endDate: BOOKED.date,
    });

    // A party of 15 now has nothing on that day: the 16 is blocked, the 14 and the 12 are free
    // and too small. The departure list says which of the two problems it is.
    await page.goto(`${BOOKED_DAY}&guests=15`);
    await expect(page.getByText(`Nothing on`)).toBeVisible();
    await expect(page.getByTestId("slot-15:30")).toContainText("14 max");
    await expect(page.getByTestId("slot-15:30")).not.toContainText("Sold out");

    // The legend names the party size it is filtering by, so the marked days are legible.
    await expect(page.getByText("Too big for 15")).toBeVisible();

    // The same day, a party of 12: back on sale. Without this the test would pass against a
    // page that had simply broken.
    await page.goto(`${BOOKED_DAY}&guests=12`);
    await expect(page.getByTestId("slot-15:30")).toContainText("2 boats open");
  });

  /**
   * A slot someone else is mid-payment on must not be advertised (#620).
   *
   * `deriveVirtualAvailability` has supported this since 12.1 — `holds` + `asOf`, lazy-on-read
   * with no cron (`availability.ts:185`, `:301`). Neither caller passed them, so the whole branch
   * was dead in production: the slot rendered "1 boat left", the loser walked the entire funnel,
   * and the CAS rejected them at the end with "that departure was just taken while you were
   * checking out". The guard existed and never ran.
   *
   * Both cases in one test on purpose. Asserting only that a live hold hides the slot would pass
   * against a change that simply hides every hold forever — the expiry comparison IS the feature,
   * and nothing else exercises it, because no cron ever deletes an expired row.
   */
  test("a live checkout hold takes the slot off sale; an expired one does not", async ({ page }) => {
    // 15:30 is open in the fixture — 13:30 is the seeded booking, so a hold there would prove
    // nothing (already sold out) and the test would pass with the feature reverted.
    await plantCheckoutHold({
      id: "hold-live-620",
      vesselId: DEMO.vesselId,
      date: BOOKED.date,
      time: "15:30",
      offeringId: DEMO_OFFERING,
      guestCount: 2,
      // Far future — this test must not turn into a clock race at the top of a minute.
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    await page.goto(BOOKED_DAY);
    // Three boats run at 15:30; the hold takes one off sale, leaving two.
    await expect(page.getByTestId("slot-15:30")).toContainText("2 boats open");
    // The neighbour is untouched: the hold subtracts ONE slot, not the boat's day.
    await expect(page.getByTestId("slot-17:30")).toContainText("3 boats open");

    // An EXPIRED hold is inert. Nothing deletes these rows, so a row that has aged out sits in
    // the table forever — if the comparison were dropped it would silently keep a slot off sale.
    await plantCheckoutHold({
      id: "hold-expired-620",
      vesselId: DEMO.vesselId,
      date: BOOKED.date,
      time: "17:30",
      offeringId: DEMO_OFFERING,
      guestCount: 2,
      expiresAt: "2020-01-01T00:00:00.000Z",
    });

    await page.goto(BOOKED_DAY);
    await expect(page.getByTestId("slot-17:30")).toContainText("3 boats open");
  });

  /**
   * The stepper moves the number under your thumb and then settles the URL (#715).
   *
   * It used to be pure client state, which is why the count reset every time you picked a date.
   * Now the count filters what the server renders, so it has to reach the server — but a
   * navigation per tap would make a control people tap repeatedly feel broken. Local state moves
   * first, a debounced `router.replace` follows. Both halves are asserted: an implementation that
   * only did the second would fail the immediate assertion, and one that only did the first would
   * fail the URL assertion and take the calendar filter down with it.
   */
  test("the stepper moves instantly and settles the URL", async ({ page }) => {
    await page.goto(BOOKED_DAY);

    const count = page.getByTestId("guest-count");
    await expect(count).toHaveText(String(SMALLEST.coiMaxPax)); // 12

    await clickHydrated(page.getByRole("button", { name: "More guests" }));
    await expect(count).toHaveText("13"); // immediately — before any navigation

    // …and the URL catches up on its own, without another interaction.
    await page.waitForURL(/guests=13/);
    await expect(page.getByTestId("continue")).toHaveAttribute("href", /guests=13/);
    // The date survived the sync — this is the "guests reset when the date changes" wrinkle in
    // reverse, and it is the reason the count is in the URL at all.
    await expect(page).toHaveURL(new RegExp(`date=${BOOKED.date}`));
  });

  test("the stepper stops at one guest and at the biggest boat", async ({ page }) => {
    await page.goto(`${BOOKED_DAY}&guests=1`);
    const fewer = page.getByRole("button", { name: "Fewer guests" });
    await expect(page.getByTestId("guest-count")).toHaveText("1");
    await expect(fewer).toBeDisabled();

    // The ceiling is the offering's largest hull, and there is deliberately nothing past it: a
    // party that doesn't fit Brew 2 is not a booking this system can take (operator, 2026-08-16).
    await page.goto(`${BOOKED_DAY}&guests=${BIGGEST.coiMaxPax}`);
    await expect(page.getByTestId("guest-count")).toHaveText(String(BIGGEST.coiMaxPax));
    await expect(page.getByRole("button", { name: "More guests" })).toBeDisabled();
    // The disabled `+` and the standing "up to N" hint are the whole message. There is
    // deliberately no sentence that appears at the ceiling — it said nothing those two don't and
    // it pushed the calendar down the screen on the last tap (operator, 2026-08-16).
    // Scoped to the card: the hero carries its own "up to 16 guests that day", which is the DAY's
    // ceiling rather than the stepper's, and an unscoped matcher can't tell the two apart.
    await expect(page.getByTestId("guest-card").getByText(`up to ${BIGGEST.coiMaxPax}`)).toBeVisible();
  });

  test("the party size survives picking a date and paging a month", async ({ page }) => {
    await page.goto(`/book?guests=14`);
    await page.getByRole("link", { name: "Next month" }).click();
    await page.waitForURL(/guests=14/);
    await expect(page.getByTestId("guest-count")).toHaveText("14");

    // …and through a date pick, which is the navigation that used to reset it outright.
    await page.getByRole("link", { name: String(Number(BOOKED.date.slice(8, 10))), exact: true }).first().click();
    await page.waitForURL(/date=/);
    await expect(page.getByTestId("guest-count")).toHaveText("14");
  });

  // **The title says "an empty month" and the assertions do not depend on one** — worth knowing
  // before you reason about this test, because #797 nearly got it marked broken on exactly that
  // misreading. The prompt below renders whenever NO DATE IS SELECTED (`book/page.tsx`, the else
  // branch of the slot list), and `goto("/book")` passes no `date`. Whether the month has
  // availability never enters into it. The paging assertion is likewise about the month LABEL,
  // not about emptiness: the demo window is one month ahead, so it costs exactly one page.
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
