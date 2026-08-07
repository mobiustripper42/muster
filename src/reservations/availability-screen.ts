/**
 * Customer availability screen (Phase 12.4, #457) — the pure view model behind the public
 * `/book` page. Turns the offering + its derived `VirtualSlot[]` (12.0 `deriveVirtualAvailability`)
 * into exactly what the "Date & time" mockup draws: a month calendar of day states, the
 * time-slot rows for a chosen date (whole-boat "boats open", NOT fake seat counts — DEC-125
 * / no-seat-word), and the whole-boat party fare for a guest count (`composeFare`, 12.2).
 *
 * Pure + integer-cents throughout; the page does the repo reads and hangs hrefs off this. Kept
 * separate from the admin `calendar-grid` view model: that one is crew-centric (a day's grid of
 * every vessel); this is customer-centric (one offering, availability a customer can buy).
 */

import type { Offering, Vessel } from "../domain/entities.js";
import type { VirtualSlot } from "./availability.js";
import { composeFare, type Fare } from "./pricing.js";

/** Sunday-first weekday of an ISO `yyyy-mm-dd` (0=Sun…6=Sat), read at UTC midnight (DST-safe).
 *  Sunday-first to match the customer calendar's `S M T W T F S` header — the admin grid's
 *  Monday-first `weekdayMon0` is a separate audience. */
export function weekdaySun0(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Days in an ISO month (`year`, `month` 1..12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `min` → "1h 40min" / "2h" / "45min". Whole-hour trips drop the minutes; sub-hour drop the
 *  hours. Undefined ⇒ null (the hero omits the duration line rather than printing "0min"). */
export function formatDuration(min: number | undefined): string | null {
  if (min === undefined || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

/** Customer-facing "boats open" wording for a departure time (DEC-125 whole-boat, no seats).
 *  `tight` (1 left) reads warn; `open` reads ok; 0 is sold out. */
export function boatsOpenLabel(open: number): { text: string; tone: "open" | "tight" | "sold" } {
  if (open <= 0) return { text: "Sold out", tone: "sold" };
  if (open === 1) return { text: "1 boat left", tone: "tight" };
  return { text: `${open} boats open`, tone: "open" };
}

/** "HH:MM" → "1:30 PM" (customer-facing clock). */
export function formatClock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "HH:MM" → "11:30a" / "1:30p" — the terse slot-row form. */
export function shortClock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}${h < 12 ? "a" : "p"}`;
}

/** "2026-07-18" → "Sat Jul 18" (UTC-read, DST-safe). */
export function formatShortDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** First-of-month ISO for `year`/`month` shifted by whole months (for calendar prev/next nav). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number; first: string } {
  const base = new Date(Date.UTC(year, month - 1 + delta, 1));
  const y = base.getUTCFullYear();
  const mo = base.getUTCMonth() + 1;
  return { year: y, month: mo, first: `${y}-${String(mo).padStart(2, "0")}-01` };
}

export type DayState = "blank" | "off" | "avail" | "soldout" | "selected";

export interface DayCell {
  /** The day-of-month number, or null for a leading blank pad cell. */
  day: number | null;
  /** ISO date for a real cell (absent on blanks). */
  date?: string;
  state: DayState;
}

/**
 * Aggregate a day's slots to one calendar state:
 *  - no slots at all ⇒ `off` (not scheduled / off-season)
 *  - any `available` slot ⇒ `avail`
 *  - slots exist but none available (all booked/held/blocked) ⇒ `soldout`
 * A past day is always `off` regardless of slots (you can't book yesterday).
 */
export function dayState(slots: readonly VirtualSlot[], date: string, today: string): DayState {
  if (date < today) return "off";
  if (slots.length === 0) return "off";
  return slots.some((s) => s.status === "available") ? "avail" : "soldout";
}

export interface MonthCalendar {
  /** e.g. "July 2026". */
  label: string;
  year: number;
  /** 1..12. */
  month: number;
  /** 7-column, Sunday-first grid including leading blank pad cells. */
  days: DayCell[];
}

/**
 * Build the month grid for `year`/`month` (1..12). `slotsByDate` is the derived availability
 * keyed by ISO date; `selectedDate` (if in this month) wins the `selected` state over its
 * availability. Sunday-first, with leading blanks so day 1 lands under its weekday column.
 */
export function buildMonthCalendar(
  year: number,
  month: number,
  slotsByDate: Map<string, VirtualSlot[]>,
  selectedDate: string | null,
  today: string,
): MonthCalendar {
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const pad = weekdaySun0(`${year}-${String(month).padStart(2, "0")}-01`);
  const days: DayCell[] = [];
  for (let i = 0; i < pad; i++) days.push({ day: null, state: "blank" });
  const total = daysInMonth(year, month);
  for (let d = 1; d <= total; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const state = date === selectedDate ? "selected" : dayState(slotsByDate.get(date) ?? [], date, today);
    days.push({ day: d, date, state });
  }
  return { label, year, month, days };
}

export interface SlotRow {
  /** Departure clock "HH:MM". */
  time: string;
  /** Whole boats still available at this time across the offering's vessels. */
  boatsOpen: number;
  /** Lowest display base among this time's available boats (cents); the fare composes over it. */
  priceCents: number;
  /** Largest COI cap among this time's bookable boats — the guest ceiling for THIS departure,
   *  not the offering's fleet-wide max. A multi-vessel offering can have a big and a small boat
   *  at the same time; once the big one is taken the ceiling drops to the small one's cap. */
  capacity: number;
  soldOut: boolean;
}

/**
 * Collapse one date's per-vessel slots to per-time rows the customer picks from. A time is
 * listed once with `boatsOpen` = how many of its boats are `available`; `priceCents` is the
 * lowest display base among those (what "Continue" will price). A time whose boats are all
 * taken still lists, `soldOut`, struck through — parity with the mockup's honest scarcity.
 */
export function buildSlotRows(slotsForDate: readonly VirtualSlot[]): SlotRow[] {
  const byTime = new Map<string, VirtualSlot[]>();
  for (const s of slotsForDate) {
    const arr = byTime.get(s.time);
    if (arr) arr.push(s);
    else byTime.set(s.time, [s]);
  }
  const rows: SlotRow[] = [];
  for (const [time, arr] of byTime) {
    const open = arr.filter((s) => s.status === "available");
    // Price + capacity come from the OPEN boats (what a customer can actually book); when
    // none are open, fall back to all of the time's boats so a sold-out row still prices/caps.
    const pool = open.length > 0 ? open : arr;
    rows.push({
      time,
      boatsOpen: open.length,
      priceCents: Math.min(...pool.map((s) => s.priceCents)),
      capacity: Math.max(...pool.map((s) => s.capacity)),
      soldOut: open.length === 0,
    });
  }
  return rows.sort((a, b) => a.time.localeCompare(b.time));
}

export interface GuestPricing extends Fare {
  count: number;
  included: number;
  cap: number;
  extraGuestPriceCents: number;
}

/**
 * The whole-boat party fare for `guestCount` at a chosen base (the selected slot's price).
 * Included count is the offering's `includedGuestCount`, or the boat cap when unset (no
 * extra-guest charge below cap). `cap` is the whole-boat ceiling. Delegates the money to
 * `composeFare` so this screen and checkout price identically.
 */
export function guestPricing(
  offering: Pick<Offering, "includedGuestCount" | "extraGuestPriceCents">,
  cap: number,
  baseCents: number,
  guestCount: number,
): GuestPricing {
  const included = offering.includedGuestCount ?? cap;
  const count = Math.min(Math.max(guestCount, 1), cap);
  const fare = composeFare({
    baseCents,
    guestCount: count,
    includedGuestCount: included,
    extraGuestPriceCents: offering.extraGuestPriceCents,
  });
  return { ...fare, count, included, cap, extraGuestPriceCents: offering.extraGuestPriceCents };
}

/** Whole-boat capacity for an offering = the largest COI cap among its vessels (each boat is
 *  sold whole; the biggest sets the guest ceiling the picker offers). 0 if it has no vessels. */
export function offeringCapacity(offering: Pick<Offering, "vesselIds">, vessels: readonly Vessel[]): number {
  const ids = new Set(offering.vesselIds.map(String));
  const caps = vessels.filter((v) => ids.has(String(v.id))).map((v) => v.coiMaxPax);
  return caps.length > 0 ? Math.max(...caps) : 0;
}
