/**
 * Customer availability screen (Phase 12.4, #457) — "Date & time", the first designed public
 * booking surface. Replaces the throwaway 11.6 harness that lived here (DEC-108). Re-expresses
 * the approved mockup (docs/design/mockups — "Muster · Customer booking flow", screen 1) against
 * Muster's own design tokens (DEC-021: read the mockup's values, don't import them). Gated behind
 * `RESERVATIONS` (DEC-111).
 *
 * Zero-JS except one island (DEC-133): date and time are picked by `AppLink` server navigation
 * — each `scroll={false}`, so choosing a date or a departure leaves you where you were rather
 * than throwing you back to the hero on every pick;
 * only the guest stepper is client, so the running total moves live. The picked base price comes
 * from the URL-selected slot (server-derived), the guest count from the URL too — the footer's
 * Continue link carries both to checkout (`/book/checkout`, built in 12.5).
 *
 * **The order is guests → date → time → continue (#715).** It used to be the reverse, and the
 * page's own header said so. Party size is the first thing that decides what a customer can buy
 * and it was the last thing we asked: the hero advertised the fleet's biggest boat, the calendar
 * offered every day that had any boat free, and a party of 15 discovered at checkout that the
 * only hull open that afternoon takes 12. Guests now filter the calendar and the departure list,
 * which is why the count is a URL param rather than island state — the server needs it. The
 * operator's standard, and the acceptance behind the acceptance: **never show a customer
 * something they cannot buy.**
 */
import type { Block, CheckoutHold, Event, Location, Offering, Reservation, Vessel } from "@core/domain/entities.js";
import { vesselDateOf } from "@core/config/tenant.js";
import { deriveVirtualAvailability, type VirtualSlot } from "@core/reservations/availability.js";
import {
  boatsOpenLabel,
  bookHref,
  buildMonthCalendar,
  buildSlotRows,
  formatClock,
  formatDuration,
  formatShortDay,
  guestPricing,
  offeringCapacity,
  offeringMinCapacity,
  shiftMonth,
  shortClock,
  type SlotRow,
} from "@core/reservations/availability-screen.js";
import { formatCents } from "@core/reservations/calendar-detail.js";
import { AppLink } from "../../../components/ui/app-link";
import { Notice } from "../../../components/ui/notice";
import { getRepo } from "../../lib/repo";
import { BookingProvider, Footer, GuestCard } from "./book-controls";
import { reservationsEnabled } from "../../lib/flags";

export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

type Search = { offering?: string; date?: string; time?: string; guests?: string };

export default async function BookPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!reservationsEnabled()) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-xl font-semibold">Reservations are off</h1>
        <p className="mt-2 text-muted">
          Set <code>RESERVATIONS=true</code> to enable booking (DEC-111).
        </p>
      </main>
    );
  }

  const sp = await searchParams;
  let offerings: Offering[];
  let vessels: Vessel[];
  let blocks: Block[];
  let events: Event[];
  let reservations: Reservation[];
  let locations: Location[];
  let holds: CheckoutHold[];
  try {
    const repo = getRepo();
    [offerings, vessels, blocks, events, reservations, locations, holds] = await Promise.all([
      repo.listOfferings(),
      repo.listVessels(),
      repo.listBlocks(),
      repo.listEvents(),
      repo.listAllReservations(),
      repo.listLocations(),
      repo.listCheckoutHolds(),
    ]);
  } catch {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Notice tone="bad">Couldn&rsquo;t load availability. Please try again in a moment.</Notice>
      </main>
    );
  }

  const live = offerings.filter((o) => o.status === "live");
  if (live.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-xl font-semibold">Nothing on the schedule yet</h1>
        <p className="mt-2 text-muted">There are no bookable cruises right now. Check back soon.</p>
      </main>
    );
  }

  // Resolve the offering: the ?offering param, else the sole live one, else a thin picker.
  const chosen = sp.offering ? live.find((o) => String(o.id) === sp.offering) : live.length === 1 ? live[0] : undefined;
  if (!chosen) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="mb-4 text-xl font-semibold">Choose a cruise</h1>
        <div className="flex flex-col gap-3">
          {live.map((o) => (
            <AppLink
              key={String(o.id)}
              href={bookHref({ offering: String(o.id) })}
              className="rounded-card border border-line bg-card px-4 py-3 hover:border-accent"
            >
              <div className="font-semibold">{o.name}</div>
              {o.description && <div className="mt-1 text-sm text-muted line-clamp-2">{o.description}</div>}
            </AppLink>
          ))}
        </div>
      </main>
    );
  }

  const offeringId = String(chosen.id);
  const location = locations.find((l) => String(l.id) === String(chosen.locationId));
  const cap = offeringCapacity(chosen, vessels);

  // Party size, resolved before anything else is derived — it filters everything below (#715).
  // Both bounds are read off THIS offering's boats: nothing here knows the fleet is 12/14/16.
  //
  // The default is the SMALLEST boat, not 1 and not 2. Landing there means the customer opens on
  // the fullest calendar the offering can show — every hull fits, so nothing is filtered out —
  // and days only start disappearing once they step past a boat. Starting at the largest would
  // do the opposite and open on the emptiest month.
  const minCap = offeringMinCapacity(chosen, vessels);
  const parsedGuests = sp.guests !== undefined ? Number.parseInt(sp.guests, 10) : NaN;
  const guests = Number.isFinite(parsedGuests)
    ? Math.min(Math.max(parsedGuests, 1), Math.max(cap, 1))
    : Math.max(minCap, 1);
  // Only carried on this page's own links once the customer has actually chosen — the first
  // visit keeps a clean URL, and re-resolves to the same default on arrival.
  const hrefGuests = sp.guests !== undefined ? guests : undefined;

  // Month window: the month of ?date, else today's. Derive availability across the whole month so
  // every future day gets a state; past days fall to `off` in the view model regardless.
  const today = vesselDateOf(new Date());
  const anchor = sp.date && ISO_DAY.test(sp.date) ? sp.date : today;
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  const monthStart = `${anchor.slice(0, 7)}-01`;
  const monthEnd = shiftMonth(year, month, 1).first > monthStart ? shiftMonth(year, month, 1).first : monthStart;
  // Derive over [monthStart, lastDayOfMonth]. lastDay = day before next month's first.
  const lastDay = new Date(Date.parse(`${monthEnd}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  // `holds` + `asOf` (#620). The deriver has supported hold-awareness since 12.1 and NEITHER
  // caller passed them, so the branch was dead in production: a slot another customer was
  // actively paying for rendered as available, the loser walked the whole funnel, and the write
  // CAS rejected them at the end with "that departure was just taken while you were checking
  // out". The guard existed and never ran.
  //
  // `asOf` is required for a hold to count at all — absent, the deriver treats none as live
  // (conservative by design, since the CAS is still the real backstop). Vessel-local day for the
  // window, UTC instant for expiry: `expiresAt` is UTC and the comparison is string-lexical.
  const slots = deriveVirtualAvailability({
    offerings: [chosen],
    vessels,
    dateRange: { start: monthStart, end: lastDay },
    blocks,
    events,
    reservations,
    holds,
    asOf: new Date().toISOString(),
  });
  const slotsByDate = new Map<string, VirtualSlot[]>();
  for (const s of slots) {
    const arr = slotsByDate.get(s.date);
    if (arr) arr.push(s);
    else slotsByDate.set(s.date, [s]);
  }

  // Selected date: the ?date if it's this month, in the future, and has availability; else null.
  // Deliberately NOT gated on the party fitting: stepping the count up past the boats that run
  // on your chosen day should keep you on that day and explain, not silently drop the selection.
  const selectedDate =
    sp.date && ISO_DAY.test(sp.date) && sp.date >= today && slotsByDate.has(sp.date) ? sp.date : null;
  const calendar = buildMonthCalendar(year, month, slotsByDate, selectedDate, today, guests);

  const rows: SlotRow[] = selectedDate ? buildSlotRows(slotsByDate.get(selectedDate) ?? [], guests) : [];
  // Bookable = free AND big enough. `fits` is what changed here: a departure with two open boats
  // that both seat 12 is not a departure a party of 14 can be auto-selected onto.
  const availRows = rows.filter((r) => !r.soldOut && r.fits);
  // Selected time: ?time if still bookable for this party, else the first row that is.
  const selectedRow =
    (sp.time && availRows.find((r) => r.time === sp.time)) || availRows[0] || undefined;

  const baseCents = selectedRow ? selectedRow.priceCents : null;
  // Pricing reads the boat this party will actually be PUT ON — the smallest that fits, which is
  // the order `candidateVessels` claims in (DEC-109). `guestPricing` falls back to it for the
  // included count, and on a 12/14/16 departure a party of 12 is going on the 12; quoting them
  // "16 guests included" describes a hull the claim would hand to somebody else.
  //
  // The STEPPER's ceiling is a different number again (`cap`, the offering's largest boat):
  // guests are chosen before a departure is, so at first render there is no slot to read from.
  const slotCap = selectedRow ? selectedRow.boatCapacity : minCap || cap;
  const fare = baseCents !== null ? guestPricing(chosen, slotCap, baseCents, guests) : null;
  // What the hero promises. Once a day is picked, the fleet-wide maximum is a claim about boats
  // that may not run that day — the exact lie #715 is about — so it narrows to the day's real
  // ceiling. Before that, the offering's largest boat is honest: it IS the most this trip can
  // ever take.
  const dayCap = selectedDate
    ? Math.max(0, ...rows.filter((r) => !r.soldOut).map((r) => r.capacity))
    : cap;
  const durationLabel = formatDuration(chosen.tripLengthMinutes);
  const dateTimeLabel = selectedDate && selectedRow ? `${formatShortDay(selectedDate)} · ${formatClock(selectedRow.time)}` : null;
  const continueBase =
    selectedDate && selectedRow
      ? `/book/checkout?offering=${encodeURIComponent(offeringId)}&date=${selectedDate}&time=${encodeURIComponent(selectedRow.time)}`
      : null;
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const canPrev = prev.first >= `${today.slice(0, 7)}-01`; // don't page before the current month

  return (
    <main className="min-h-screen bg-bg px-3 py-6 sm:px-4 sm:py-8">
      <div className="mx-auto flex w-full max-w-[900px] flex-col overflow-hidden rounded-[18px] border border-line bg-card shadow-sm">
        {/* header */}
        <div className="flex flex-none items-center gap-2.5 border-b border-line px-4 py-3">
          {live.length > 1 && (
            <AppLink
              href={bookHref({})}
              aria-label="Back to cruises"
              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-line text-muted"
            >
              ‹
            </AppLink>
          )}
          <div className="flex min-w-0 flex-col">
            <b className="truncate text-[13.5px] font-semibold">Book a cruise</b>
            <span className="text-[11.5px] text-muted">Private charter</span>
          </div>
          {/* This slot held a static "🔒 Secure" badge — no mockup and no decision behind it, not
              a link, and making a claim nothing verifies. It is the most visible spot on the one
              muster URL a customer who lost their link is likely to reach, so it earns its place
              as the recovery entry point instead (operator, 2026-08-15). */}
          {/* Two lines rather than one (operator, 2026-08-15): "Already booked?" is what makes
              the link legible to someone scanning — without it, "Find my booking" reads as a
              feature of the page they are already on. Stacked so the pair doesn't crowd the
              title at 375px, and the question sits INSIDE the link so the whole block is one
              44px tap target rather than a label beside a small hyperlink. */}
          <AppLink
            href="/b/find"
            className="ml-auto flex min-h-[44px] flex-none items-center"
          >
            {/* The stack lives in an inner wrapper, NOT on the anchor. `AppLink` wraps its
                children in `NavLinkLabel` — a `relative inline-flex items-center` span for the
                nav spinner — so a `flex-col` on the anchor never reaches these two and they
                render side by side. Column + centred here, inside that wrapper. */}
            <span className="flex flex-col items-center leading-tight">
              <span className="text-[10.5px] text-muted">Already booked?</span>
              <span className="text-[11.5px] font-semibold text-accent">Find my booking</span>
            </span>
          </AppLink>
        </div>

        <BookingProvider
          baseCents={baseCents}
          included={fare?.included ?? slotCap}
          extraPriceCents={chosen.extraGuestPriceCents}
          cap={cap}
          guests={guests}
          offering={sp.offering}
          date={selectedDate ?? sp.date}
          time={selectedRow?.time ?? sp.time}
        >
          <div className="flex flex-col overflow-y-auto">
            {/* hero */}
            {/* Mockup delta: its uppercase eyebrow is the fleet BRAND ("Brew Boat"). No tenant
                brand string exists in config yet (BrewBoat is only hard-coded in comments), so the
                eyebrow is dropped rather than repeating the offering name or inventing a brand —
                it fills in when tenant branding lands. */}
            <div className="border-b border-line bg-gradient-to-br from-accent/10 to-transparent px-[18px] py-4">
              <h1 className="text-[19px] font-semibold tracking-[-0.01em]">{chosen.name}</h1>
              <div className="mt-1 text-[12.5px] text-muted">
                {[
                  location?.name,
                  durationLabel && `${durationLabel} on the water`,
                  dayCap > 0 && (selectedDate ? `up to ${dayCap} guests that day` : `up to ${dayCap} guests`),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>

            {/* Guests FIRST (#715) — above the calendar, because it decides what the calendar is
                allowed to offer. Full width rather than in the right-hand column: on md+ the
                column sits beside the calendar, and a control the customer is meant to use before
                the calendar cannot live to its right. */}
            <div className="border-b border-line px-[18px] py-4">
              <GuestCard />
            </div>

            <div className="px-[18px] pb-2 pt-4 md:grid md:grid-cols-[1fr_320px] md:items-start md:gap-6">
              {/* calendar */}
              <div>
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">Pick a date</div>
                <div className="mb-2 flex items-center gap-2">
                  <b className="text-sm font-semibold">{calendar.label}</b>
                  <span className="flex-1" />
                  {canPrev ? (
                    <AppLink
                      href={bookHref({ offering: sp.offering, date: prev.first, guests: hrefGuests })}
                      scroll={false}
                      aria-label="Previous month"
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-muted"
                    >
                      ‹
                    </AppLink>
                  ) : (
                    <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-faint opacity-40">
                      ‹
                    </span>
                  )}
                  <AppLink
                    href={bookHref({ offering: sp.offering, date: next.first, guests: hrefGuests })}
                    scroll={false}
                    aria-label="Next month"
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-muted"
                  >
                    ›
                  </AppLink>
                </div>
                <div className="grid grid-cols-7">
                  {DOW.map((d, i) => (
                    <span key={i} className="py-1 text-center text-[10px] font-bold text-faint">
                      {d}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calendar.days.map((c, i) => {
                    if (c.state === "blank") return <span key={i} className="aspect-square" />;
                    const base = "flex aspect-square items-center justify-center rounded-[9px] text-[13px] tabular-nums";
                    if (c.state === "avail")
                      return (
                        <AppLink
                          key={i}
                          href={bookHref({ offering: sp.offering, date: c.date, guests: hrefGuests })}
                          scroll={false}
                          spinner="none"
                          className={`${base} border border-ok-line bg-ok-bg font-semibold text-ok hover:border-ok`}
                        >
                          {c.day}
                        </AppLink>
                      );
                    if (c.state === "selected")
                      return (
                        <span key={i} className={`${base} border border-accent bg-accent font-bold text-white`}>
                          {c.day}
                        </span>
                      );
                    if (c.state === "soldout")
                      return (
                        <span key={i} className={`${base} text-faint line-through`}>
                          {c.day}
                        </span>
                      );
                    // Boats run that day and they're free — they're just too small for this
                    // party. Marked, not hidden, and marked DIFFERENTLY from sold out: hiding it
                    // is silent, and struck-through says "someone got there first" when the
                    // truth is "bring fewer people, or this trip isn't for you" (#715).
                    if (c.state === "toobig")
                      return (
                        <span
                          key={i}
                          title={`No boat on this day takes ${guests}`}
                          className={`${base} border border-dashed border-line text-faint`}
                        >
                          {c.day}
                        </span>
                      );
                    return (
                      <span key={i} className={`${base} text-faint opacity-50`}>
                        {c.day}
                      </span>
                    );
                  })}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <i className="h-2.5 w-2.5 rounded-[3px] border border-ok-line bg-ok-bg" />
                    Available
                  </span>
                  {/* No "Selected" key. A customer who can't tell which day they just tapped is
                      not helped by a legend entry — the filled accent cell either reads as
                      selected on its own or the cell is wrong (operator, 2026-08-16). */}
                  <span className="inline-flex items-center gap-1.5">
                    <i className="h-2.5 w-2.5 rounded-[3px] border border-line bg-bg" />
                    Sold out
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-line bg-bg" />
                    Too big for {guests}
                  </span>
                </div>
              </div>

              {/* time slots */}
              <div className="mt-5 md:mt-0">
                {selectedDate ? (
                  <>
                    <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">
                      {formatShortDay(selectedDate)} — choose a start time
                    </div>
                    {rows.length === 0 && <Notice>No departures on this day.</Notice>}
                    {rows.length > 0 && availRows.length === 0 && (
                      <Notice>
                        Nothing on {formatShortDay(selectedDate)} takes {guests}. Try another day, or fewer guests.
                      </Notice>
                    )}
                    {rows.map((r) => {
                      const label = boatsOpenLabel(r.boatsOpen);
                      const selected = selectedRow?.time === r.time;
                      const inner = (
                        <>
                          <span className="min-w-[74px] text-[15px] font-semibold tabular-nums">{shortClock(r.time)}</span>
                          {/* A departure that IS free but can't take this party gets its own line
                              rather than "Sold out" — the boats are sitting there, and telling a
                              party of 15 they were beaten to it is both false and unactionable.
                              This one is actionable: drop to {r.capacity} and it opens up. */}
                          <span
                            className={`text-xs font-semibold ${
                              !r.soldOut && !r.fits
                                ? "text-faint"
                                : label.tone === "open"
                                  ? "text-ok"
                                  : label.tone === "tight"
                                    ? "text-warn"
                                    : "text-faint"
                            }`}
                          >
                            {/* "12 max", not "Takes 12" (operator, 2026-08-16) — this sits in the
                                same column as "1 boat left", so it reads as a status, and a limit
                                is what it is. No seat word (DEC-125): the number is the boat's
                                whole-boat capacity, not a count of anything for sale. */}
                            {!r.soldOut && !r.fits ? `${r.capacity} max` : label.text}
                          </span>
                          <span className="ml-auto font-mono text-sm font-semibold">{formatCents(r.priceCents)}</span>
                        </>
                      );
                      if (r.soldOut || !r.fits)
                        return (
                          <div
                            key={r.time}
                            data-testid={`slot-${r.time}`}
                            className={`mb-2.5 flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 opacity-55 ${
                              r.soldOut ? "border-line" : "border-dashed border-line"
                            }`}
                          >
                            {inner}
                          </div>
                        );
                      return (
                        <AppLink
                          key={r.time}
                          data-testid={`slot-${r.time}`}
                          href={bookHref({ offering: sp.offering, date: selectedDate, time: r.time, guests: hrefGuests })}
                          scroll={false}
                          spinner="none"
                          className={`mb-2.5 flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 ${
                            selected ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-line hover:border-accent"
                          }`}
                        >
                          {inner}
                        </AppLink>
                      );
                    })}
                  </>
                ) : (
                  <Notice>Pick an available date to see start times.</Notice>
                )}
              </div>
            </div>

            <Footer dateTimeLabel={dateTimeLabel} continueBase={continueBase} />
          </div>
        </BookingProvider>
      </div>

    </main>
  );
}
