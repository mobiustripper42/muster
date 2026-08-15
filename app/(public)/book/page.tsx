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
 * from the URL-selected slot (server-derived), the guest count from the island — the footer's
 * Continue link carries both to checkout (`/book/checkout`, built in 12.5). Guests reset to the
 * default when the date or time changes (not carried in the URL) — a minor, accepted v1 wrinkle;
 * the natural order is date → time → guests → continue.
 */
import type { Block, CheckoutHold, Event, Location, Offering, Reservation, Vessel } from "@core/domain/entities.js";
import { vesselDateOf } from "@core/config/tenant.js";
import { deriveVirtualAvailability, type VirtualSlot } from "@core/reservations/availability.js";
import {
  boatsOpenLabel,
  buildMonthCalendar,
  buildSlotRows,
  formatClock,
  formatDuration,
  formatShortDay,
  guestPricing,
  offeringCapacity,
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
const DEFAULT_GUESTS = 2;

type Search = { offering?: string; date?: string; time?: string; guests?: string };

/** Build a `/book` href, omitting empty axes so the default URL stays clean. */
function bookHref(p: { offering?: string; date?: string; time?: string }): string {
  const q = new URLSearchParams();
  if (p.offering) q.set("offering", p.offering);
  if (p.date) q.set("date", p.date);
  if (p.time) q.set("time", p.time);
  const s = q.toString();
  return s ? `/book?${s}` : "/book";
}

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
  const selectedDate =
    sp.date && ISO_DAY.test(sp.date) && sp.date >= today && slotsByDate.has(sp.date) ? sp.date : null;
  const calendar = buildMonthCalendar(year, month, slotsByDate, selectedDate, today);

  const rows: SlotRow[] = selectedDate ? buildSlotRows(slotsByDate.get(selectedDate) ?? []) : [];
  const availRows = rows.filter((r) => !r.soldOut);
  // Selected time: ?time if still available today, else the first available row.
  const selectedRow =
    (sp.time && availRows.find((r) => r.time === sp.time)) || availRows[0] || undefined;

  const baseCents = selectedRow ? selectedRow.priceCents : null;
  // The stepper ceiling is the SELECTED departure's open-boat cap (a multi-vessel offering can
  // lose its big boat and drop to the small one), NOT the offering's fleet-wide max — so a
  // customer can't pick a count the remaining boat can't seat and get rejected only at checkout.
  const slotCap = selectedRow ? selectedRow.capacity : cap;
  const fare = baseCents !== null ? guestPricing(chosen, slotCap, baseCents, DEFAULT_GUESTS) : null;
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
            <span className="text-[11.5px] text-muted">Whole boat, one group</span>
          </div>
          {/* This slot held a static "🔒 Secure" badge — no mockup and no decision behind it, not
              a link, and making a claim nothing verifies. It is the most visible spot on the one
              muster URL a customer who lost their link is likely to reach, so it earns its place
              as the recovery entry point instead (operator, 2026-08-15). */}
          <AppLink
            href="/b/find"
            className="ml-auto flex min-h-[44px] flex-none items-center text-[11.5px] font-semibold text-accent"
          >
            Find my booking
          </AppLink>
        </div>

        <BookingProvider
          baseCents={baseCents}
          included={fare?.included ?? slotCap}
          extraPriceCents={chosen.extraGuestPriceCents}
          cap={slotCap}
          initialGuests={DEFAULT_GUESTS}
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
                {[location?.name, durationLabel && `${durationLabel} on the water`, cap > 0 && `up to ${cap} guests`]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
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
                      href={bookHref({ offering: sp.offering, date: prev.first })}
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
                    href={bookHref({ offering: sp.offering, date: next.first })}
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
                          href={bookHref({ offering: sp.offering, date: c.date })}
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
                    return (
                      <span key={i} className={`${base} text-faint opacity-50`}>
                        {c.day}
                      </span>
                    );
                  })}
                </div>
                <div className="mt-2.5 flex gap-3.5 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <i className="h-2.5 w-2.5 rounded-[3px] border border-ok-line bg-ok-bg" />
                    Available
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
                    Selected
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="h-2.5 w-2.5 rounded-[3px] border border-line bg-bg" />
                    Sold out
                  </span>
                </div>
              </div>

              {/* time slots + guest card */}
              <div className="mt-5 md:mt-0">
                {selectedDate ? (
                  <>
                    <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.07em] text-faint">
                      {formatShortDay(selectedDate)} — choose a start time
                    </div>
                    {rows.length === 0 && <Notice>No departures on this day.</Notice>}
                    {rows.map((r) => {
                      const label = boatsOpenLabel(r.boatsOpen);
                      const selected = selectedRow?.time === r.time;
                      const inner = (
                        <>
                          <span className="min-w-[74px] text-[15px] font-semibold tabular-nums">{shortClock(r.time)}</span>
                          <span
                            className={`text-xs font-semibold ${
                              label.tone === "open" ? "text-ok" : label.tone === "tight" ? "text-warn" : "text-faint"
                            }`}
                          >
                            {label.text}
                          </span>
                          <span className="ml-auto font-mono text-sm font-semibold">{formatCents(r.priceCents)}</span>
                        </>
                      );
                      if (r.soldOut)
                        return (
                          <div
                            key={r.time}
                            data-testid={`slot-${r.time}`}
                            className="mb-2.5 flex items-center gap-3 rounded-xl border border-line bg-card px-3.5 py-3 opacity-55"
                          >
                            {inner}
                          </div>
                        );
                      return (
                        <AppLink
                          key={r.time}
                          data-testid={`slot-${r.time}`}
                          href={bookHref({ offering: sp.offering, date: selectedDate, time: r.time })}
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
                    <GuestCard />
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
