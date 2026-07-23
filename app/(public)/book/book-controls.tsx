"use client";

/**
 * The one client island on the availability screen (12.4, #457). Date and time are picked by
 * server navigation (zero-JS `<AppLink>`s — see the page); ONLY the guest stepper needs to move
 * the running total live, so it's the sole client state (server-rendering-default, worthwhile
 * exception — recorded in DEC-133).
 *
 * `BookingProvider` holds the guest count and derives the whole-boat party fare client-side with
 * the SAME formula as `composeFare` (base + extras over the included count); `GuestCard` and the
 * sticky `Footer` read it via context. The server-rendered hero / calendar / slot rows are passed
 * through as `children` — no functions cross the boundary (RSC serialization trap), only plain
 * numbers and strings.
 */

import { createContext, useContext, useState, type ReactNode } from "react";

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
  initialGuests,
  children,
}: {
  baseCents: number | null;
  included: number;
  extraPriceCents: number;
  cap: number;
  initialGuests: number;
  children: ReactNode;
}) {
  const [count, setCountRaw] = useState(() => Math.min(Math.max(initialGuests, 1), Math.max(cap, 1)));
  const setCount = (n: number) => setCountRaw(Math.min(Math.max(n, 1), Math.max(cap, 1)));
  const extraGuests = Math.max(0, count - included);
  const fareCents = baseCents === null ? null : baseCents + extraGuests * extraPriceCents;
  const value: BookingCtx = { count, setCount, included, extraPriceCents, cap, baseCents, extraGuests, fareCents };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The "How many guests?" card — whole-boat note, stepper, included/extra copy. Inert (hidden)
 *  when nothing is bookable on the selected day. */
export function GuestCard() {
  const { count, setCount, included, extraPriceCents, cap, baseCents } = useBooking();
  if (baseCents === null) return null;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">How many guests?</div>
      <div className="mb-2.5 rounded-[9px] border border-line bg-bg px-3 py-2 text-[12.5px] text-muted">
        <b className="text-ink">You&rsquo;ve got the whole boat.</b> The price is the boat, not the seat.
      </div>
      <div className="flex items-center gap-3">
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
      <div className="mt-2.5 text-xs text-muted">
        <b className="text-ink">{included} guests included.</b> Each extra is {money(extraPriceCents)} — up to {cap} for
        this boat.
      </div>
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
            <b className="text-[18px] font-bold tabular-nums">{money(fareCents!)}</b>
            <span className="text-[10.5px] text-faint">{dateTimeLabel}</span>
          </>
        ) : (
          <span className="text-[13px] text-muted">Pick a date &amp; time to continue</span>
        )}
      </div>
      {canContinue ? (
        <a
          data-testid="continue"
          href={`${continueBase}&guests=${count}`}
          className="ml-auto flex items-center gap-2 rounded-[11px] bg-accent px-[22px] py-[13px] text-[14.5px] font-semibold text-white active:brightness-90"
        >
          Continue →
        </a>
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
