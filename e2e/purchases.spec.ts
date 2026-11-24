/**
 * Purchases — the order list (task 12.12a, #465).
 *
 * The `reservation` seed books Muster trips across three boats with NO payments recorded, so
 * every card is `unpaid` — which is exactly the state the mockup never drew and the one this list
 * must not mislabel as "deposit" (that would report money that never arrived).
 *
 * **Counts are derived from the fixture, not typed.** They were literal `3`s until #715 grew the
 * seed to ten bookings, and every one of them went red at once — a spec that hardcodes how many
 * cards a shared fixture produces is a spec that breaks on every future seed change, for no gain.
 * What this file actually cares about is that the count is the same on the badges and the status
 * dropdown and that all of them read `unpaid`; the number itself is the seed's business.
 *
 * What one card shows is `components/admin/purchase-card.test.ts`, and the rules behind the list are
 * `src/reservations/purchases-view.test.ts`. This file is the page: the cards under their days, the
 * filters and where they navigate, the caption and the notices (issue #1285).
 *
 * Runs desktop + 375px.
 */
import type { Page } from "@playwright/test";
import { TEST_DATABASE_URL } from "../db/reset-test.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { fmtDayHeader, resolveWindow } from "../src/admin/date-window.js";
import { addDays } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import { formatCents } from "../src/reservations/calendar-detail.js";
import { seedInvoice } from "../src/reservations/seed-reservation.js";
import {
  test,
  expect,
  eventIdOfReservation,
  fillHydrated,
  moveEventDate,
  plantPayment,
  resetAndSeed,
  selectOptionHydrated,
  signInAsAdmin,
} from "./fixtures.js";
import { BOOKED, BOOKED_2, DEMO, demoReservationId, OPEN_TIME, TODAY } from "./reservation-demo.js";

/** Every seeded booking becomes one Muster order. */
const ORDERS = DEMO.bookings.length;

type Booking = (typeof DEMO.bookings)[number];
const idOf = (b: Booking) => demoReservationId(b.date, b.time, b.vesselId);
const owesOf = (b: Booking) => seedInvoice(b.priceCents).totalCents;

/** One per card. */
const badges = (page: Page) => page.locator('[data-testid^="row-state-"]');
/** A card's link, by the booking it opens. */
const cardLink = (page: Page, id: string) =>
  page.locator(`a[href^="/admin/calendar/${encodeURIComponent(id)}"]`);

const statusSelect = (page: Page) => page.locator('select[name="state"]');
/** The count an entry of the status dropdown carries; `""` is the all-statuses entry. */
const countOf = async (page: Page, state: string) =>
  Number(((await statusSelect(page).locator(`option[value="${state}"]`).textContent()) ?? "").replace(/\D/g, ""));

/** The date chips, and the lit one, by the preset each opens. */
const presets = (page: Page, lit = "") =>
  page
    .locator(`a[href*="preset="]${lit}`)
    .evaluateAll((els) => els.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get("preset")));
const litPresets = (page: Page) => presets(page, '[aria-current="page"]');

/** The caption: the one line holding both the number of cards and the dates they cover. */
const caption = (page: Page, cards: number, scope: string) =>
  page.getByText(new RegExp(`^(?=.*\\b${cards}\\b)(?=.*${scope})`));

const ALL_DATES = resolveWindow({ preset: "all" }, new Date(), { allowAll: true }).scope;
const NEXT_7 = resolveWindow({}, new Date()).scope;

const NOTICES = ["empty-search", "empty-window", "empty-status"] as const;

/** Exactly `want` of the three notices is on the page; `null` is none of them. */
async function expectNotice(page: Page, want: (typeof NOTICES)[number] | null): Promise<void> {
  if (want) await expect(page.getByTestId(want)).toBeVisible();
  for (const id of NOTICES) await expect(page.getByTestId(id)).toHaveCount(id === want ? 1 : 0);
}

/** What the booking's frozen invoice charges in all. */
async function invoiceTotalOf(reservationId: string): Promise<number> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const r = await repo.getReservation(asId<"ReservationId">(reservationId));
    if (!r?.invoice) throw new Error(`no invoice on ${reservationId}`);
    return r.invoice.totalCents;
  } finally {
    await repo.close();
  }
}

test.describe("admin /admin/purchases", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("lists Muster orders with derived state; nothing paid reads UNPAID", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/purchases?preset=all");

    // Marcus books twice on the same phone (the repeat-guest fixture), Dana once — those two are
    // named because they are easy to find, not because they are the whole list.
    await expect(page.getByText("Marcus Webb")).toHaveCount(2);
    await expect(page.getByText("Dana Cho")).toHaveCount(1);

    // No payments seeded ⇒ every order is UNPAID, never "deposit". Scoped to the card badges:
    // the status dropdown carries the same words, so a page-wide text match would count those too.
    await expect(badges(page)).toHaveCount(ORDERS);
    for (const text of await badges(page).allTextContents()) expect(text.trim()).toBe("unpaid");

    // Nothing paid, so Dana owes the whole invoice: 43900 + 3183 = 47083.
    await expect(page.getByTestId(`owed-${idOf(BOOKED_2)}`)).toContainText("$470.83");

    // The card carries no phone, however the customer typed it.
    await expect(page.getByText("555-0102")).toHaveCount(0);
    await expect(page.getByText("555-0148")).toHaveCount(0);
  });

  test("AC1: every booking is one card under its trip day, soonest first, and an old sort=purchase is not carried", async ({
    page,
  }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/purchases?preset=all&sort=purchase");

    await expect(badges(page)).toHaveCount(ORDERS);
    for (const b of DEMO.bookings) await expect(page.getByTestId(`row-state-${idOf(b)}`)).toBeVisible();

    // The day headings and the cards, in the order they are drawn.
    const days = [...new Set(DEMO.bookings.map((b) => b.date))].sort();
    const drawn = await page
      .locator(':is(h1, h2, h3, h4, h5, h6), a[href^="/admin/calendar/resv-"]')
      .evaluateAll((els) =>
        els.map((el) =>
          el instanceof HTMLAnchorElement
            ? { card: new URL(el.href).searchParams.get("date") }
            : { heading: el.textContent ?? "" },
        ),
      );
    const sequence = drawn.flatMap((d) => {
      if (d.heading === undefined) return [`card ${d.card}`];
      const day = days.find((iso) => d.heading.includes(fmtDayHeader(iso)));
      return day ? [`day ${day}`] : [];
    });
    expect(sequence).toEqual(
      days.flatMap((day) => [
        `day ${day}`,
        ...DEMO.bookings.filter((b) => b.date === day).map(() => `card ${day}`),
      ]),
    );

    await expect(page.locator('a[href*="sort="], input[name="sort"]')).toHaveCount(0);
  });

  test("AC1: the whole card opens the calendar's detail pane — no second detail surface", async ({ page }) => {
    const dana = idOf(BOOKED_2);
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/purchases?q=Cho&preset=all");

    // A bare click at the badge's spot, not on the name: the card is the link.
    const badge = page.getByTestId(`row-state-${dana}`);
    await expect(badge).toBeVisible();
    await badge.scrollIntoViewIfNeeded();
    const box = (await badge.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect
      .poll(() => {
        const u = new URL(page.url());
        return { path: decodeURIComponent(u.pathname), date: u.searchParams.get("date") };
      })
      .toEqual({ path: `/admin/calendar/${dana}`, date: BOOKED_2.date });
    await expect(page.getByTestId("reservation-detail")).toBeVisible();
    await expect(page.getByTestId("reservation-detail").getByRole("heading", { name: "Dana Cho", level: 2 })).toBeVisible();
  });

  test("AC3: a day's heading carries what is owed under it, and no other figure", async ({ page }) => {
    // Marcus is the only booking on his first day; paid in full, that day owes nothing.
    await plantPayment({ id: "pay-ac3", reservationId: idOf(BOOKED), amountCents: owesOf(BOOKED) });
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/purchases?preset=all");

    const owedOn = (date: string) =>
      formatCents(DEMO.bookings.filter((b) => b.date === date).reduce((sum, b) => sum + owesOf(b), 0));
    const heading = (date: string) => page.getByRole("heading", { name: fmtDayHeader(date) });

    // Four bookings under it: the heading is the day and the sum owed, with no count and no total.
    const busy = heading(BOOKED_2.date);
    await expect(busy).toContainText(owedOn(BOOKED_2.date));
    const rest = (await busy.textContent())!.replace(fmtDayHeader(BOOKED_2.date), "").replace(owedOn(BOOKED_2.date), "");
    expect(rest).not.toMatch(/\d/);

    const settled = heading(BOOKED.date);
    await expect(settled).toBeVisible();
    expect((await settled.textContent())!.replace(fmtDayHeader(BOOKED.date), "")).not.toMatch(/\d/);
  });

  test("AC7: the date chips are next7, days30, past and all, and next7 is the default", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/purchases");

    await expect.poll(() => presets(page)).toEqual(["next7", "days30", "past", "all"]);
    await expect.poll(() => litPresets(page)).toEqual(["next7"]);
  });

  test("AC7: From and To are under More filters, open only for a custom range", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    // `type=date`: the other forms carry a range as hidden fields of the same names.
    const from = page.locator('input[type="date"][name="from"]');
    const to = page.locator('input[type="date"][name="to"]');

    await page.goto("/admin/purchases?preset=days30");
    await expect(page.getByText("More filters")).toBeVisible();
    await expect(from).toBeHidden();
    await expect(to).toBeHidden();
    await page.getByText("More filters").click();
    await expect(from).toBeVisible();

    await page.goto(`/admin/purchases?from=${TODAY}&to=${addDays(TODAY, 3)}`);
    await expect(from).toBeVisible();
    await expect(from).toHaveValue(TODAY);
    await expect(to).toHaveValue(addDays(TODAY, 3));
  });

  test("AC8: the status dropdown carries counts and narrows the list", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/purchases?preset=all");

    await expect(statusSelect(page)).toBeVisible();
    expect(await countOf(page, "")).toBe(ORDERS);
    expect(await countOf(page, "unpaid")).toBe(ORDERS);
    expect(await countOf(page, "paid")).toBe(0);

    // A status with no members lists no cards.
    await selectOptionHydrated(statusSelect(page), "paid");
    // The pick carries the window (issue #1142 AC8), so the list it opens is still every date.
    await page.waitForURL((u) => u.searchParams.get("state") === "paid" && u.searchParams.get("preset") === "all");
    await expect(badges(page)).toHaveCount(0);

    // Back to all statuses restores the list.
    await selectOptionHydrated(statusSelect(page), "");
    await expect(page.getByText("Dana Cho")).toHaveCount(1);
  });

  test("AC8: picking a status keeps the dates and the search, and all-statuses clears it", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/purchases?preset=all&q=Cho");

    await expect(statusSelect(page)).toHaveValue("");
    const values = await statusSelect(page)
      .locator("option")
      .evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value));
    expect(values[0]).toBe("");
    expect(values.slice(1).sort()).toEqual(
      ["awaiting", "balance_due", "cancelled", "deposit", "disputed", "paid", "pending", "refunded", "unpaid"],
    );

    const params = () => Object.fromEntries(new URL(page.url()).searchParams);
    await selectOptionHydrated(statusSelect(page), "unpaid");
    await expect.poll(params).toEqual({ preset: "all", q: "Cho", state: "unpaid" });
    await expect(statusSelect(page)).toHaveValue("unpaid");
    await expect(badges(page)).toHaveCount(1);

    await selectOptionHydrated(statusSelect(page), "");
    await expect.poll(params).toEqual({ preset: "all", q: "Cho" });

    const range = { from: TODAY, to: addDays(TODAY, 3) };
    await page.goto(`/admin/purchases?${new URLSearchParams(range)}`);
    await selectOptionHydrated(statusSelect(page), "deposit");
    await expect.poll(params).toEqual({ ...range, state: "deposit" });
  });

  test("search finds an order by name and by punctuated phone, and survives a filter", async ({
    page,
  }) => {
    await signInAsAdmin(page, "eric");

    await page.goto("/admin/purchases?q=Cho&preset=all");
    await expect(page.getByText("Dana Cho")).toHaveCount(1);
    await expect(page.getByText("Marcus Webb")).toHaveCount(0);

    // Marcus's seeded phone is "216-555-0148"; punctuation shouldn't matter.
    await page.goto("/admin/purchases?q=(216)+555-0148&preset=all");
    await expect(page.getByText("Marcus Webb")).toHaveCount(2);
    await expect(page.getByText("Dana Cho")).toHaveCount(0);

    // Search + state compose (both seeded orders are unpaid).
    await page.goto("/admin/purchases?q=Cho&state=unpaid&preset=all");
    await expect(page.getByText("Dana Cho")).toHaveCount(1);
  });

  test("AC9: a search finds bookings on every date, narrowed by the status, and leaving it keeps the rest", async ({
    page,
  }) => {
    await signInAsAdmin(page, "eric");

    // No seeded booking is inside the next 7 days, the window this URL names.
    await page.goto("/admin/purchases?q=Marcus");
    await expect(badges(page)).toHaveCount(2);
    // A date chip leaves the search: its link carries no q.
    expect(await page.locator('a[href*="preset="][href*="q="]').count()).toBe(0);

    await page.goto("/admin/purchases?q=Marcus&state=paid");
    await expect(badges(page)).toHaveCount(0);

    await page.goto("/admin/purchases?q=Marcus&state=unpaid&preset=days30");
    await expect(badges(page)).toHaveCount(2);
    await page.getByRole("link", { name: "Clear" }).click();
    await expect
      .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
      .toEqual({ preset: "days30", state: "unpaid" });
  });

  test("AC9: the lit date chip is the window's, and none is lit while searching or under Balance due", async ({
    page,
  }) => {
    await signInAsAdmin(page, "eric");

    await page.goto("/admin/purchases?preset=days30");
    await expect.poll(() => litPresets(page)).toEqual(["days30"]);

    for (const query of ["preset=days30&q=Marcus", "preset=days30&state=balance_due"]) {
      await page.goto(`/admin/purchases?${query}`);
      await expect(statusSelect(page)).toBeVisible();
      expect(await litPresets(page)).toEqual([]);
    }
  });

  test("AC10: a search narrows every entry's count, whatever the dates", async ({ page }) => {
    await signInAsAdmin(page, "eric");

    // The next 7 days hold nothing.
    await page.goto("/admin/purchases");
    await expect(statusSelect(page)).toBeVisible();
    expect(await countOf(page, "")).toBe(0);

    await page.goto("/admin/purchases?q=Marcus");
    await expect(statusSelect(page)).toBeVisible();
    expect(await countOf(page, "")).toBe(2);
    expect(await countOf(page, "unpaid")).toBe(2);
    expect(await countOf(page, "deposit")).toBe(0);
  });

  test("AC13: the caption carries the number of cards and the dates they cover", async ({ page }) => {
    await moveEventDate(await eventIdOfReservation(idOf(BOOKED)), addDays(TODAY, 2));
    await signInAsAdmin(page, "eric");

    await page.goto("/admin/purchases");
    await expect(badges(page)).toHaveCount(1);
    await expect(caption(page, 1, NEXT_7)).toBeVisible();

    await page.goto("/admin/purchases?preset=all");
    await expect(badges(page)).toHaveCount(ORDERS);
    await expect(caption(page, ORDERS, ALL_DATES)).toBeVisible();

    // A search covers every date, whatever window the URL names.
    await page.goto("/admin/purchases?q=Marcus");
    await expect(badges(page)).toHaveCount(2);
    await expect(caption(page, 2, ALL_DATES)).toBeVisible();
  });

  test("AC13: under Balance due the caption covers all dates", async ({ page }) => {
    await resetAndSeed("reservation", "self-cancel");
    await signInAsAdmin(page, "eric");

    await page.goto("/admin/purchases?state=balance_due");
    await expect(badges(page).first()).toBeVisible();
    await expect(caption(page, await badges(page).count(), ALL_DATES)).toBeVisible();
  });

  test("AC14: an empty list shows the search, window or status notice, and only that one", async ({ page }) => {
    await signInAsAdmin(page, "eric");

    for (const [query, want] of [
      // A search, with any status, in a window that is itself empty.
      ["q=zzzz", "empty-search"],
      ["q=zzzz&state=paid", "empty-search"],
      ["q=zzzz&state=balance_due", "empty-search"],
      // The next 7 days hold nothing, whatever the status.
      ["", "empty-window"],
      ["state=paid", "empty-window"],
      // The window holds bookings and the status none; Balance due ignores the window.
      ["preset=all&state=paid", "empty-status"],
      ["state=balance_due", "empty-status"],
    ] as const) {
      await page.goto(`/admin/purchases?${query}`);
      await expectNotice(page, want);
    }
  });

  test("AC14: with no orders at all, the no-orders notice is the only one", async ({ page }) => {
    await resetAndSeed();
    await signInAsAdmin(page, "eric");

    for (const query of ["", "q=zzzz", "state=paid", "state=balance_due", "preset=all"]) {
      await page.goto(`/admin/purchases?${query}`);
      await expect(page.getByText(/No Muster orders yet/)).toBeVisible();
      await expectNotice(page, null);
    }
  });

  /**
   * A phone booking waiting on its payment link is on the list, with its own status (issue #1082
   * part C). Before, an unpaid phone booking didn't appear here at all.
   */
  test("a phone booking awaiting payment has its own status and card, and opens its pane", async ({ page }) => {
    await signInAsAdmin(page, "eric");
    const BOOK = `/admin/calendar?date=${BOOKED.date}&hold=${encodeURIComponent(`${DEMO.vesselId}|${OPEN_TIME}`)}&book=1&guests=2`;
    await page.goto(BOOK);
    await fillHydrated(page.getByPlaceholder("Guest’s full name"), "Phone Caller");
    await fillHydrated(page.getByPlaceholder(/^Mobile/), "216-555-0199");
    await page.getByTestId("book-phone").click();
    await page.waitForURL(/\/admin\/calendar\/resv-/);
    const id = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);

    await page.goto("/admin/purchases?preset=all");
    await expect(statusSelect(page)).toBeVisible();
    expect(await countOf(page, "awaiting")).toBe(1);
    await selectOptionHydrated(statusSelect(page), "awaiting");
    await expect(badges(page)).toHaveCount(1);
    await expect(page.getByTestId(`row-state-${id}`)).toHaveText("awaiting payment");
    await expect(page.getByText("Phone Caller")).toBeVisible();
    // The trip is the booking's own — it has no Event until paid.
    await expect(page.getByRole("heading", { name: fmtDayHeader(BOOKED.date) })).toBeVisible();
    await expect(page.getByText("3:30 PM")).toBeVisible();
    await expect(page.getByText("Brew 3")).toBeVisible();
    // It owes the whole frozen invoice, tip and service fee included.
    await expect(page.getByTestId(`owed-${id}`)).toContainText(formatCents(await invoiceTotalOf(id)));

    await cardLink(page, id).click();
    await page.waitForURL(/\/admin\/calendar\/resv-/);
    await expect(page.getByTestId("booking-state")).toHaveText("Awaiting payment");
  });
});
