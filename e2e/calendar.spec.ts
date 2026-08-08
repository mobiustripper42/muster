/**
 * Day·Grid reservation calendar (task 12.11, #464) — drives /admin/calendar end to end.
 * Read-only slice: one day as fleet-vessel columns × a fixed 8:00–21:30 axis, each computed
 * departure a duration-spanning block (deriveVirtualAvailability, DEC-125).
 *
 * The `reservation` seed builds a LIVE offering + owned days (the 10th–16th of NEXT month, #646)
 * on Brew 3 with two booked trips: 13:30 on the 12th Marcus Webb (party 8), 15:30 on the 13th
 * Dana Cho. So on the booked day Brew 3 shows one BOOKED block (Marcus Webb) + two OPEN (15:30, 17:30
 * — the offering's other departures). The Booked filter hides the opens, keeps the booking.
 * Runs desktop + 375px (the grid scrolls; the booked block stays present).
 */
import { test, expect, resetAndSeed, signInAsAdmin } from "./fixtures.js";
import { shortTime as shortLabel } from "../src/reservations/calendar-grid.js";
import { xolaFixture } from "../src/reservations/seed-xola.js";
import {
  BOOKED,
  BOOKED_2,
  DEMO,
  OPEN_TIME,
  TODAY,
  demoReservationId,
  monthDay,
} from "./reservation-demo.js";

/** The xola fixture's days, derived from the SAME clock read the seed subprocess gets (#646). */
const XOLA = xolaFixture(TODAY);

test.describe("admin /admin/calendar", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation"); // live offering + owned days + 2 booked trips on Brew 3
  });

  test("Day·Grid renders the day; Booked filter hides opens", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);

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
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);

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

    // The mockup's remaining actions are still deferred — refund waits on #472, message on
    // #119 (a customer must never reach the crew line). Narrowed from "zero buttons" when the
    // balance link shipped (11.2b): that assertion encoded a scope decision we changed on
    // purpose, so it names the deferred actions now instead of counting.
    for (const action of ["Refund", "Cancel", "Message", "Guests", "Change time"]) {
      await expect(pane.getByRole("button", { name: action })).toHaveCount(0);
    }

    // One route, two native layouts (no client JS): the grid sits BESIDE the pane on desktop
    // and is hidden on mobile, where the pane is the whole page. It's hidden rather than
    // omitted because a server render can't know the viewport — the markup ships either way.
    const grid = page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" });
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    if (wide) await expect(grid).toBeVisible();
    else await expect(grid).toBeHidden();

    // Back returns to the day you came from.
    await page.getByRole("link", { name: "Back to calendar" }).click();
    await page.waitForURL(new RegExp(`/admin/calendar\\?date=${BOOKED.date}`));
    await expect(page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" })).toBeVisible();
  });

  /** A direct link with no ?date must land on the reservation's OWN day, not today's grid. */
  test("deep link with no date resolves the reservation's own day", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar/${demoReservationId(BOOKED_2.date, BOOKED_2.time)}`);

    const pane = page.getByTestId("reservation-detail");
    await expect(page.getByRole("heading", { name: "Dana Cho", level: 1 })).toBeVisible();
    await expect(pane).toContainText(monthDay(BOOKED_2.date));
    await expect(pane).toContainText("3:30 PM");
    // Dana's fare is 43900 → tax 3183 → 47083 due.
    await expect(pane).toContainText("$439.00");
    await expect(pane).toContainText("$470.83");
  });

  /**
   * The balance link (11.2b, DEC-107) — the operator door for a service that shipped tested
   * with no caller. The seeded booking has no payments, so the whole fare is outstanding and
   * the action offers itself. The Stripe MINT itself isn't exercised here (it needs a live
   * Stripe session); this drives the two states the action redirects back into, which is
   * where the UI logic actually lives.
   */
  test("balance link: offered when money is owed, hidden once settled", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar/${encodeURIComponent(demoReservationId(BOOKED.date, BOOKED.time))}?date=${BOOKED.date}`);

    const pane = page.getByTestId("reservation-detail");
    await expect(pane).toContainText("$588.80"); // balance due
    await expect(pane.getByRole("button", { name: "Create balance link" })).toBeVisible();

    // The minted link renders with a copy affordance, and the button gives way to it.
    await page.goto(
      `/admin/calendar/${encodeURIComponent(demoReservationId(BOOKED.date, BOOKED.time))}?date=${BOOKED.date}&balanceUrl=https%3A%2F%2Fcheckout.stripe.com%2Fc%2Fpay%2Ftest123`,
    );
    await expect(pane.getByTestId("balance-link")).toContainText("checkout.stripe.com/c/pay/test123");
    await expect(pane.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(pane.getByRole("button", { name: "Create balance link" })).toHaveCount(0);

    // A refusal explains itself in operator language, not a reason code.
    await page.goto(
      `/admin/calendar/${encodeURIComponent(demoReservationId(BOOKED.date, BOOKED.time))}?date=${BOOKED.date}&balanceErr=stripe_not_configured`,
    );
    await expect(pane).toContainText("Stripe isn’t configured");
    await expect(pane).not.toContainText("stripe_not_configured");
  });

  test("an unknown reservation 404s rather than rendering an empty pane", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    const res = await page.goto("/admin/calendar/resv-does-not-exist");
    expect(res?.status()).toBe(404);
  });

  /**
   * Hold a single departure from the calendar (#703) — the write the registry's "make a hold on
   * the calendar" copy has been promising since 12.10 with nothing able to produce one.
   *
   * The round trip is the test: hold it, see it dark, see the row the registry renders for it,
   * release it from the same place, see it back on sale. Asserting only the hold would pass with
   * a one-way door, which is the version of this feature nobody can undo.
   */
  test("an open slot is blocked from the calendar, lands in the registry, and is unblocked", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);

    // Addressed by SCOPE, not by label: both dark cards read "Blocked", and only the slot-scoped
    // one is undoable here. A `hasText` filter would match either.
    const slotBlock = page.locator('[data-testid="cal-block"][data-blocked-by="slot"]');

    // 3:30 is open (the offering's second departure; nobody has taken it).
    await expect(page.getByText(`open · ${shortLabel(OPEN_TIME)}`)).toBeVisible();

    // Clicking it asks first — a misclick on a busy grid must not silently unsell a departure.
    await page.getByText(`open · ${shortLabel(OPEN_TIME)}`).click();
    const confirm = page.getByTestId("hold-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("Brew 3");
    await expect(confirm).toContainText(shortLabel(OPEN_TIME));
    // Still on sale until the second click — the confirm is a question, not a receipt.
    await expect(page.getByText(`open · ${shortLabel(OPEN_TIME)}`)).toBeVisible();

    await confirm.getByRole("button", { name: "Block it" }).click();
    await expect(page.getByTestId("hold-confirm")).toHaveCount(0);
    await expect(page.getByText(`open · ${shortLabel(OPEN_TIME)}`)).toHaveCount(0);
    await expect(slotBlock).toBeVisible();
    await expect(slotBlock).toContainText("Blocked");
    // The chip's COUNT, not just its label. Renaming this chip dropped the number once already
    // — the lookup was cast to `keyof typeof counts`, so the stale key read `undefined` and
    // rendered as nothing. A label-only assertion would have passed through that.
    await expect(page.getByTestId("filter-blocked")).toHaveText("Blocked 1");
    await expect(page.getByTestId("filter-open")).toHaveText("Open 1");

    // One block family, one list: the registry renders the row it already knew how to render.
    await page.goto("/admin/blocks?kind=slot");
    const row = page.getByTestId("block-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Slot");
    await expect(row).toContainText("Brew 3");
    await expect(row).toContainText("one departure · opens on the calendar");
    await expect(row).toContainText("1");

    // The row IS the forward link — one click to the block's own day, no read-only aside in
    // between (#703). Clicking it must not select it into the editor.
    await row.click();
    await page.waitForURL(new RegExp(`/admin/calendar\\?date=${BOOKED.date}`));

    // Unblocked from the calendar, the slot comes back on sale (DEC-125, reversible-in-spirit).
    await slotBlock.click();
    const release = page.getByTestId("hold-confirm");
    await expect(release).toContainText("back on sale");
    await release.getByRole("button", { name: "Unblock it" }).click();

    await expect(page.getByText(`open · ${shortLabel(OPEN_TIME)}`)).toBeVisible();
    await expect(slotBlock).toHaveCount(0);
  });

  /**
   * A slot block is PHYSICAL — one boat, one clock time — so it removes every offering that
   * proposes that boat-time, not the one card the operator happened to click (#702, #703).
   *
   * The xola seed's fleet offering sells Brew 3 at the demo offering's own departure times, so
   * `days.onGrid` draws TWO open cards on one slot. That doubling is the whole test: with a
   * single offering per boat the href could be keyed on the offering and nothing would notice.
   */
  test("blocking one card takes the boat-time off the market for every offering selling it", async ({
    page,
  }) => {
    await resetAndSeed("reservation", "xola");
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${XOLA.days.onGrid}&filter=open`);

    // Two offerings, one boat-time: two open cards at 3:30 on Brew 3 before anything is blocked.
    const opens = page
      .getByTestId("cal-block")
      .filter({ hasText: `open · ${shortLabel(OPEN_TIME)}` })
      .and(page.locator(`[data-vessel="${DEMO.vesselId}"]`));
    await expect(opens).toHaveCount(2);

    // Both cards lead to the SAME confirm — the href is the boat-time, not the offering. This
    // is the assertion the doubling exists for; clicking can only ever reach one of them,
    // because the two cards are drawn exactly on top of each other (#702's collision layout is
    // not this task). So the last one in DOM order is the one painted on top and clickable.
    const hrefs = await opens.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(new Set(hrefs).size).toBe(1);

    await opens.last().click();
    const confirm = page.getByTestId("hold-confirm");
    // The scope is said out loud, because the row this writes cannot show it.
    await expect(confirm).toContainText("2 offerings");
    await confirm.getByRole("button", { name: "Block it" }).click();

    // BOTH are gone from the open filter — one physical boat, one block.
    await expect(
      page
        .getByTestId("cal-block")
        .filter({ hasText: `open · ${shortLabel(OPEN_TIME)}` })
        .and(page.locator(`[data-vessel="${DEMO.vesselId}"]`)),
    ).toHaveCount(0);
    // And the registry attributes both to the one block it wrote.
    await page.goto("/admin/blocks?kind=slot");
    await expect(page.getByTestId("block-row")).toHaveCount(1);
    await expect(page.getByTestId("block-row")).toContainText("2");
  });
});
