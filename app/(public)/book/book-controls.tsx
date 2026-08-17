"use client";

/**
 * The one client island on the availability screen (12.4, #457). Date and time are picked by
 * server navigation (zero-JS `<AppLink>`s — see the page); ONLY the guest stepper needs to move
 * the running total live, so it's the sole client state (server-rendering-default, worthwhile
 * exception — recorded in DEC-133).
 *
 * **#715 changed what the count means.** Guests now come first and *filter* the calendar and the
 * departure list, so the SERVER needs the number — it lives in the URL alongside `date` and
 * `time`, and the server-resolved value is the source of truth. The island keeps local state only
 * so the number and the price move under the customer's thumb; a debounced `router.replace`
 * settles the URL once they stop tapping. That is one round trip per *interaction* rather than
 * per tap: stepping 2 → 14 navigates once, at the end.
 *
 * Why the sync is unconditional, when only some steps change what's bookable: a step that stays
 * within one boat's capacity (11 → 12 on a 12/14/16 offering) genuinely changes nothing the
 * server renders, and skipping it looks like free UX. But every day cell, slot row and month
 * pager on the page is a server-rendered link with `guests` baked into its href. Leave the URL
 * un-navigated and those links keep the OLD count, so the next date pick silently restores it —
 * which is the "guests reset when the date changes" wrinkle #715 exists to kill, back again in
 * miniature. The links and the count have to move together, so the sync is unconditional and the
 * debounce is what makes it cheap.
 *
 * `BookingProvider` holds the guest count and derives the whole-boat party fare client-side with
 * the SAME formula as `composeFare` (base + extras over the included count); `GuestCard` and the
 * sticky `Footer` read it via context. The server-rendered hero / calendar / slot rows are passed
 * through as `children` — no functions cross the boundary (RSC serialization trap), only plain
 * numbers and strings.
 */

import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { bookHref } from "@core/reservations/availability-screen.js";
import { AppLink } from "../../../components/ui/app-link";

/** How long the stepper waits for the customer to stop tapping before it settles the URL. Long
 *  enough that a run of taps costs one navigation, short enough that a single tap doesn't feel
 *  like it was ignored. */
const SYNC_DELAY_MS = 350;

/** Local mirror of `formatCents` (calendar-detail) — inlined so the client bundle stays tiny. */
function money(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

interface BookingCtx {
  count: number;
  setCount: (n: number) => void;
  included: number;
  extraPriceCents: number;
  cap: number;
  /** Selected slot's display base in cents, or null when nothing is bookable/selected. */
  baseCents: number | null;
  extraGuests: number;
  fareCents: number | null;
  /** The URL is catching up with the stepper — availability on screen is one count behind. */
  syncing: boolean;
}

const Ctx = createContext<BookingCtx | null>(null);

function useBooking(): BookingCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("Booking controls must be inside <BookingProvider>");
  return c;
}

export function BookingProvider({
  baseCents,
  included,
  extraPriceCents,
  cap,
  guests,
  offering,
  date,
  time,
  children,
}: {
  baseCents: number | null;
  included: number;
  extraPriceCents: number;
  /** Stepper ceiling — the offering's largest boat. Guests are chosen before a departure is, so
   *  there is no selected slot to read a cap off yet. */
  cap: number;
  /** The server-resolved count, from the URL. Source of truth; local state chases it. */
  guests: number;
  /** The other URL axes, so the stepper can rebuild this page's href with a new count. Passed as
   *  primitives rather than an object — an object prop is a fresh reference every render and
   *  would re-arm the sync effect on each one. */
  offering?: string;
  date?: string;
  time?: string;
  children: ReactNode;
}) {
  const [count, setCountRaw] = useState(guests);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // The server has spoken: a navigation landed with a different count (a shared link, or a day
  // cell whose href carried one). Local state defers to it.
  useEffect(() => {
    setCountRaw(guests);
  }, [guests]);

  // Settle the URL once the tapping stops. `replace`, not `push` — a stepper run should leave one
  // history entry, not twelve, or Back becomes a decrement key. `scroll: false` for #690: this
  // refines the page you're on, and jumping to the hero on every guest change is the exact thing
  // that rule was written about.
  useEffect(() => {
    if (count === guests) return;
    const timer = setTimeout(() => {
      startTransition(() => {
        router.replace(bookHref({ offering, date, time, guests: count }), { scroll: false });
      });
    }, SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [count, guests, offering, date, time, router]);

  const setCount = (n: number) => setCountRaw(Math.min(Math.max(n, 1), Math.max(cap, 1)));
  const extraGuests = Math.max(0, count - included);
  const fareCents = baseCents === null ? null : baseCents + extraGuests * extraPriceCents;
  const value: BookingCtx = {
    count,
    setCount,
    included,
    extraPriceCents,
    cap,
    baseCents,
    extraGuests,
    fareCents,
    syncing: pending || count !== guests,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The "How many guests?" card — whole-boat note, stepper, included/extra copy.
 *
 * Renders whether or not a departure is picked (#715): party size is now the FIRST thing chosen,
 * so a card that hid itself until a slot existed would hide the control the customer is supposed
 * to use first. Only the per-guest pricing line waits for a slot, since it has no base to quote
 * until one is selected.
 */
export function GuestCard() {
  const { count, setCount, included, extraPriceCents, cap, baseCents, syncing } = useBooking();
  return (
    <div className="rounded-[9px] border border-line bg-bg px-3 py-3" data-testid="guest-card">
      {/* No "you've got the whole boat" note. `Private charter` in the header says it, and the
          included/extra line below says what the money buys — the sentence between them was
          inventory language dressed as reassurance (operator, 2026-08-16). */}
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">How many guests?</div>
      <div className="flex items-center gap-3" aria-busy={syncing}>
        <button
          type="button"
          aria-label="Fewer guests"
          onClick={() => setCount(count - 1)}
          disabled={count <= 1}
          className="h-[38px] w-[38px] rounded-[10px] border border-line bg-card text-xl leading-none text-ink disabled:opacity-40"
        >
          −
        </button>
        <span
          data-testid="guest-count"
          className="min-w-[34px] text-center text-[22px] font-semibold tabular-nums"
          aria-live="polite"
        >
          {count}
        </span>
        <button
          type="button"
          aria-label="More guests"
          onClick={() => setCount(count + 1)}
          disabled={count >= cap}
          className="h-[38px] w-[38px] rounded-[10px] border border-line bg-card text-xl leading-none text-ink disabled:opacity-40"
        >
          +
        </button>
        <span className="ml-auto text-xs text-faint">up to {cap}</span>
      </div>
      {/* No copy at the ceiling. The `+` disables and the row already says "up to {cap}" — a
          sentence appearing on the last tap says nothing those two don't, and it grows the card
          mid-interaction, pushing the calendar down the screen (operator, 2026-08-16). */}
      {baseCents !== null && (
        <div className="mt-2.5 text-xs text-muted">
          <b className="text-ink">{included} guests included.</b> Each extra is {money(extraPriceCents)}.
        </div>
      )}
    </div>
  );
}

/** The sticky pay bar — live total + selected date/time + Continue. `sticky bottom-0` inside the
 *  scroll region so it pins on both form factors from one DOM node. */
export function Footer({
  dateTimeLabel,
  continueBase,
}: {
  /** e.g. "Sat Jul 18 · 1:30 PM", or null when no slot is selected. */
  dateTimeLabel: string | null;
  /** Checkout href WITHOUT the guest count, e.g. "/book/checkout?offering=..&date=..&time=..".
   *  Null when nothing is bookable. Guests are appended live. */
  continueBase: string | null;
}) {
  const { fareCents, count } = useBooking();
  const canContinue = fareCents !== null && continueBase !== null;
  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-3.5 border-t border-line bg-card px-4 py-3">
      <div className="flex flex-col">
        {canContinue ? (
          <>
            <b data-testid="footer-total" className="text-[18px] font-bold tabular-nums">
              {money(fareCents!)}
            </b>
            <span className="text-[10.5px] text-faint">{dateTimeLabel}</span>
          </>
        ) : (
          <span className="text-[13px] text-muted">Pick a date &amp; time to continue</span>
        )}
      </div>
      {canContinue ? (
        <AppLink
          data-testid="continue"
          href={`${continueBase}&guests=${count}`}
          className="ml-auto flex items-center gap-2 rounded-[11px] bg-accent px-[22px] py-[13px] text-[14.5px] font-semibold text-white active:brightness-90"
        >
          Continue →
        </AppLink>
      ) : (
        <span
          aria-disabled="true"
          className="ml-auto flex cursor-not-allowed items-center gap-2 rounded-[11px] bg-accent/40 px-[22px] py-[13px] text-[14.5px] font-semibold text-white"
        >
          Continue →
        </span>
      )}
    </div>
  );
}
