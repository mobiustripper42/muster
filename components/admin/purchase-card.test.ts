/**
 * One booking's card on `/admin/purchases` (issue #1285): what it carries, what it leaves out, and
 * the one amount on it. Which words stand under the amount is checked by hand.
 *
 * Rendered with `createElement`, because `vitest.config.ts` includes no `.test.tsx`.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatCents } from "@core/reservations/calendar-detail.js";
import { dueDayLabel } from "@core/reservations/checkout-quote.js";
import type { PurchaseOwed, PurchaseRow } from "@core/reservations/purchases-view.js";
import { vesselHueClass } from "../../app/lib/vessel-hue";
import { PurchaseCard } from "./purchase-card";

const HREF = "/admin/calendar/resv-1?date=2026-12-22";
const DUE_AT = "2026-12-08T18:00:00.000Z";

const row = (over: Partial<PurchaseRow> = {}): PurchaseRow => ({
  reservationId: "resv-1",
  customerName: "Dana Cho",
  phone: "(440) 555-0102",
  email: "dana@example.com",
  date: "2026-12-22",
  time: "15:30",
  vesselId: "vessel-brew-3",
  vesselName: "Brew 3",
  // Not the hue this boat's id derives to: the stored one is what shows.
  vesselHue: 5,
  guestCount: 14,
  paidCents: 10000,
  balanceCents: 43518,
  refundedCents: 2000,
  state: "deposit",
  ...over,
});

const render = (over: Partial<PurchaseRow> = {}): string =>
  renderToStaticMarkup(createElement(PurchaseCard, { row: row(over), href: HREF }));

/** The markup's text, each tag a space. */
function text(markup: string): string {
  let out = "";
  let inTag = false;
  for (const c of markup) {
    if (c === "<") {
      inTag = true;
      out += " ";
    } else if (c === ">") {
      inTag = false;
    } else if (!inTag) {
      out += c;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/** The text of the element carrying `data-testid`, through its own close; null when absent. */
function textOf(markup: string, testId: string): string | null {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at < 0) return null;
  const start = markup.lastIndexOf("<", at);
  const tag = /^<(\w+)/.exec(markup.slice(start))![1]!;
  let depth = 0;
  for (const m of markup.slice(start).matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, "g"))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return text(markup.slice(start, start + m.index));
  }
  throw new Error(`no close for ${testId}`);
}

const amounts = (s: string) => s.match(/\$[\d,]+\.\d\d/g) ?? [];

describe("PurchaseCard", () => {
  it("AC1: it links to the booking's pane, and nowhere else", () => {
    const links = [...render().matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(links).toEqual([HREF]);
  });

  it("AC2: it carries the name, vessel, 12-hour time, guest count and status badge", () => {
    const html = render();
    const t = text(html);
    expect(t).toContain("Dana Cho");
    expect(t).toContain("Brew 3");
    expect(t).toContain("3:30 PM");
    expect(t).toMatch(/\b14\b/);
    expect(textOf(html, "row-state-resv-1")).toBe("deposit");
  });

  it("AC2: the vessel's dot is in the vessel's own colour", () => {
    expect(render()).toContain(vesselHueClass("vessel-brew-3", 5));
  });

  it("AC2: it carries no phone, email or trip date", () => {
    const t = text(render());
    expect(t).toContain("Dana Cho");
    for (const gone of ["555-0102", "4405550102", "dana@example.com", "2026-12-22", "Dec 22"]) {
      expect(t).not.toContain(gone);
    }
  });

  it.each<{ name: string; owed: PurchaseOwed }>([
    { name: "not yet due", owed: { cents: 43518, dueAt: DUE_AT, status: "due" } },
    { name: "past due", owed: { cents: 43518, dueAt: DUE_AT, status: "past_due" } },
    { name: "needing approval", owed: { cents: 43518, dueAt: DUE_AT, status: "needs_approval" } },
    { name: "declined", owed: { cents: 43518, dueAt: DUE_AT, status: "declined" } },
    { name: "with no due date", owed: { cents: 68302 } },
  ])("AC4: what is owed is the only amount on the card — $name", ({ owed }) => {
    const html = render({ owed });
    expect(amounts(text(html))).toEqual([formatCents(owed.cents)]);
    expect(textOf(html, "owed-resv-1") ?? "").toContain(formatCents(owed.cents));
  });

  it.each(["paid", "refunded", "cancelled", "disputed", "pending", "awaiting", "unpaid"] as const)(
    "AC4: a card that owes nothing carries no amount — %s",
    (state) => {
      const html = render({ state });
      expect(text(html)).toContain("Dana Cho");
      expect(amounts(text(html))).toEqual([]);
      expect(textOf(html, "owed-resv-1")).toBeNull();
    },
  );

  it("AC6: before the due date, the date is under the amount", () => {
    const html = render({ owed: { cents: 43518, dueAt: DUE_AT, status: "due" } });
    expect(textOf(html, "owed-resv-1") ?? "").toContain(dueDayLabel(DUE_AT));
  });
});
