import { formatCents } from "@core/reservations/calendar-detail.js";
import { AppLink } from "../../../../components/ui/app-link";
import { RevealSelectedCard } from "../../../../components/admin/reveal-selected-card";
import { vesselHueClass } from "../../../lib/vessel-hue";
import { Card } from "../../../../components/ui/card";
import { Badge, Tag, type Tone } from "../../../../components/ui/badge";
import {
  bookHref,
  calendarHref,
  clockTime,
  describeBlock,
  detailHref,
  selectedAttr,
  slotKey,
  slotMatchesFilter,
  type CalendarData,
} from "./calendar-view";

/**
 * The calendar's List view (16.1b, issue #1079): the day on screen as one row per departure — one
 * boat at one time — to sell from. "A customer is on the phone asking for the 5:30; put them on it."
 *
 * **A second drawing of the same day, not a second way to sell.** The rows come from the same
 * `loadCalendarData` slots and filter chip as the grid, and each row links where its grid card
 * links: a booking to its pane, an open departure to the slot pane, a blocked one to Unblock it or
 * Open that block →. **+ Book** on an open row is the slot pane's Book it, one click sooner.
 *
 * **One row per boat-time.** The grid draws one card per offering on an open boat-time (two cruises
 * selling Brew 3 at 1:30 are two cards). The list draws the departure once and says "2 cruises" —
 * the booking steps already ask which. So the chips, which count cards, can read one more than the
 * rows on a day like that.
 *
 * Never a seat count: a trip is Open or Sold (§2.10.5). "Takes 12 guests" is the boat's capacity.
 */

type RowState = "booked" | "unpaid" | "open" | "blocked" | "checking-out" | "departed";

interface ListRow {
  key: string;
  vesselId: string;
  vesselName: string;
  vesselHue: number | undefined;
  time: string;
  state: RowState;
  cruises: string[];
  /** "Marcus Webb · 8 guests", the block's name, or "Takes 12 guests". */
  who: string | null;
  xola: boolean;
  owesCents: number | undefined;
  crew: { filled: number; required: number } | undefined;
  /** Where the row opens — the same pane its grid card opens. Absent ⇒ the row is inert. */
  href: string | undefined;
  /** Where the row is named for a screen reader: what clicking it does. */
  label: string;
  bookHref: string | undefined;
  selected: boolean;
  /** Open, but every open cruise at this boat-time is inside the booking cutoff (DEC-193): the
   *  operator can book it, the website won't. The pill says so. */
  phoneOnly?: boolean;
}

const PILL: Record<RowState, { label: string; tone: Tone }> = {
  booked: { label: "Booked", tone: "ok" },
  unpaid: { label: "Unpaid", tone: "warn" },
  open: { label: "Open", tone: "neutral" },
  blocked: { label: "Blocked", tone: "accent" },
  "checking-out": { label: "Checking out", tone: "accent" },
  departed: { label: "Departed", tone: "neutral" },
};

const guests = (n: number) => `${n} ${n === 1 ? "guest" : "guests"}`;

/** The day's departures as list rows, in time order and then the fleet's order. Pure over `data`. */
export function listRows(data: CalendarData, selectedReservationId?: string): ListRow[] {
  const groups = new Map<string, typeof data.slots>();
  for (const s of data.slots) {
    if (!slotMatchesFilter(data, s)) continue;
    const k = slotKey(String(s.vesselId), s.date, s.time);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  const fleetOrder = new Map(data.vessels.map((v, i) => [String(v.id), i]));
  return [...groups.entries()]
    .map(([key, slots]) => rowOf(data, key, slots, selectedReservationId))
    .sort((a, b) => a.time.localeCompare(b.time) || (fleetOrder.get(a.vesselId) ?? 0) - (fleetOrder.get(b.vesselId) ?? 0));
}

function rowOf(
  data: CalendarData,
  key: string,
  slots: CalendarData["slots"],
  selectedReservationId: string | undefined,
): ListRow {
  const first = slots[0]!;
  const vesselId = String(first.vesselId);
  const vessel = data.vesselById.get(vesselId);
  const vesselName = vessel?.name ?? vesselId;
  const time = first.time;
  const where = `${clockTime(time)}, ${vesselName}`;
  const cruisesOf = (ss: typeof slots) => [
    ...new Set(ss.map((s) => data.offeringById.get(String(s.offeringId))?.name).filter((n): n is string => !!n)),
  ];
  const base = {
    key,
    vesselId,
    vesselName,
    vesselHue: vessel?.hue,
    time,
    cruises: cruisesOf(slots),
    who: null,
    xola: false,
    owesCents: undefined,
    crew: undefined,
    href: undefined,
    bookHref: undefined,
    selected: false,
  };
  const p = data.pending;
  const paneOnThis = p !== null && p.vesselId === vesselId && p.time === time;

  // Sold — this slot's own booking, or the trip occupying the hull (an imported Xola charter).
  const sold = slots.find((s) => s.status === "booked" || s.status === "unavailable");
  if (sold) {
    const own = sold.eventId ? data.reservationByEventId.get(String(sold.eventId)) : undefined;
    const occupying = data.tripBySlot.get(key);
    const onBoard = own ?? occupying?.reservation;
    const eventId = String(sold.eventId ?? occupying?.event.id ?? "");
    return {
      ...base,
      state: "booked",
      cruises: cruisesOf([sold]),
      who: onBoard ? `${onBoard.customerName} · ${guests(onBoard.partySize)}` : null,
      xola: occupying?.event.source === "xola" && !own,
      crew: data.crewByEventId.get(eventId),
      href: onBoard ? detailHref(data, String(onBoard.id)) : undefined,
      label: onBoard ? `${onBoard.customerName}, ${where}` : `Booked, ${where}`,
      selected: onBoard !== undefined && String(onBoard.id) === selectedReservationId,
    };
  }

  // The operator's own unpaid phone booking (16.1) — owes what its frozen invoice asks now, the
  // same figure as the pane's Owes.
  const phone = slots.some((s) => s.status === "held") ? data.phoneBookingBySlot.get(key) : undefined;
  if (phone) {
    return {
      ...base,
      state: "unpaid",
      who: `${phone.customerName} · ${guests(phone.partySize)}`,
      owesCents: phone.invoice?.amountDueNowCents,
      href: detailHref(data, String(phone.id)),
      label: `Awaiting payment, ${phone.customerName}, ${where}`,
      selected: String(phone.id) === selectedReservationId,
    };
  }

  // Open outranks blocked here, unlike `slotStatus`, on purpose. A closure is keyed on the
  // offering's location, so two cruises sharing a boat-time can disagree: one open, one blocked. The
  // grid draws both cards; this list has one row, and it is a list to SELL from — so the row says
  // what can still be sold (Open, + Book, the open cruise named) rather than hiding a sellable trip
  // behind the cruise that can't run. The booking steps only offer the open cruise.
  const open = slots.filter((s) => s.status === "available");
  if (open.length > 0) {
    const phoneOnly = open.every((s) => s.phoneOnly);
    return {
      ...base,
      state: "open",
      cruises: cruisesOf(open),
      who: `Takes ${guests(vessel?.coiMaxPax ?? first.capacity)}`,
      href: calendarHref(data, { hold: `${vesselId}|${time}` }),
      bookHref: bookHref(data, { vesselId, time }, {}),
      label: `Book or block ${where}${phoneOnly ? ", phone only" : ""}`,
      selected: paneOnThis && p.action === "hold",
      phoneOnly,
    };
  }

  if (slots.some((s) => s.status === "blocked")) {
    const hold = data.holdBySlot.get(key);
    const scoped = data.scopedBySlot.get(key);
    const block = hold ?? scoped;
    return {
      ...base,
      state: "blocked",
      who: block
        ? describeBlock(block, (id) => data.vesselById.get(id)?.name ?? id, (id) => data.locationNameById.get(id) ?? id)
        : null,
      href: hold
        ? calendarHref(data, { release: String(hold.id) })
        : calendarHref(data, { scoped: `${vesselId}|${time}` }),
      label: `${hold ? "Unblock" : "Blocked"} ${where}`,
      selected: paneOnThis && (p.action === "release" || p.action === "scoped"),
    };
  }

  // A customer at the checkout, or a departure that has left: nothing to open (as on the grid).
  const departed = slots.every((s) => s.status === "departed");
  return { ...base, state: departed ? "departed" : "checking-out", label: where };
}

/**
 * The List. `narrow` with a pane open: the cruise and crew columns go, since the pane shows both,
 * and the rest keeps its width beside it.
 */
export function CalendarList({
  data,
  selectedReservationId,
  narrow = false,
}: {
  data: CalendarData;
  selectedReservationId?: string | undefined;
  narrow?: boolean;
}) {
  const rows = listRows(data, selectedReservationId);
  const selected = rows.find((r) => r.selected);
  const cols = narrow
    ? "lg:grid-cols-[70px_92px_112px_minmax(0,1fr)_84px]"
    : "lg:grid-cols-[84px_110px_minmax(0,1.1fr)_120px_minmax(0,1.6fr)_72px_92px]";

  return (
    <Card
      data-testid="cal-list"
      data-cal-scroll
      pad="none" className={`mt-2 overflow-hidden ${narrow ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto" : ""}`}
    >
      {/* Opening a pane re-renders the page: bring the selected row back into view (#1104). */}
      <RevealSelectedCard selectedKey={selected?.key ?? ""} />
      <div
        data-cal-head
        className={`hidden gap-3 border-b border-line bg-card px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted lg:sticky lg:top-0 lg:z-10 lg:grid ${cols}`}
      >
        <div>Time</div>
        <div>Boat</div>
        {narrow ? null : <div>Cruise</div>}
        <div>State</div>
        <div>Who</div>
        {narrow ? null : <div>Crew</div>}
        <div />
      </div>

      {rows.map((r, i) => {
        const pill = PILL[r.state];
        // A firmer rule closes each departure time, so the 1:30s read as a group (the mockup's divider).
        const rule = ruleBelow(r, rows[i + 1]);
        return (
          <div
            key={r.key}
            data-testid="cal-row"
            data-vessel={r.vesselId}
            data-time={r.time}
            data-status={r.state}
            data-cal-selected={selectedAttr(r.selected)}
            className={`relative px-4 py-2.5 text-sm ${rule} ${
              r.href ? "hover:bg-bg" : ""
            } ${r.selected ? "bg-bg shadow-[inset_3px_0_0_var(--color-ink)]" : ""} flex flex-col gap-0.5 lg:grid lg:min-h-[52px] lg:items-center lg:gap-3 ${cols}`}
          >
            {/* The whole row opens its pane: one link stretched over it, named for what it does.
                `+ Book` sits above it (z-10) so it stays its own target. */}
            {r.href ? (
              <AppLink
                href={r.href}
                spinner="overlay"
                aria-label={r.label}
                aria-current={r.selected ? "page" : undefined}
                className="absolute inset-0"
              />
            ) : null}

            {/* Line 1 at 375px: time, boat, state, + Book. On desktop these are the first columns. */}
            <div className="flex items-center gap-2 lg:contents">
              <span className="font-mono text-[13px] font-semibold text-ink">{clockTime(r.time)}</span>
              <span className="inline-flex min-w-0 items-center gap-1.5 text-ink">
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${vesselHueClass(r.vesselId, r.vesselHue)}`} aria-hidden />
                <span className="truncate">{r.vesselName}</span>
              </span>
              <span className="flex-1 lg:hidden" />
              {narrow ? null : (
                <span className="hidden truncate text-ink lg:block">{cruiseText(r.cruises)}</span>
              )}
              <span>
                <Badge tone={pill.tone}>
                  {pill.label}
                  {r.phoneOnly && " · phone only"}
                </Badge>
              </span>
              {r.bookHref ? (
                <AppLink href={r.bookHref} className="btn-primary btn-sm relative z-10 lg:hidden">
                  + Book
                </AppLink>
              ) : null}
            </div>

            <div className="truncate text-[13px] text-muted lg:hidden">{cruiseText(r.cruises)}</div>

            {/* The name gives way before the owes chip does: in the narrow column beside a pane the
                amount is the part worth keeping. */}
            <div className={`flex min-w-0 items-center gap-1.5 ${r.state === "booked" || r.state === "unpaid" ? "text-ink" : "text-muted"}`}>
              <span className="min-w-0 truncate">
                {r.who ?? ""}
                {r.xola ? <span className="text-muted"> · Xola</span> : null}
                {r.crew && r.crew.required > 0 ? (
                  <span className={`lg:hidden ${r.crew.filled < r.crew.required ? "font-semibold text-warn" : "text-muted"}`}>
                    {" "}· crew {r.crew.filled}/{r.crew.required}
                  </span>
                ) : null}
              </span>
              {r.owesCents !== undefined ? (
                <Tag tone="warn" className="shrink-0">
                  owes <span className="font-mono">{formatCents(r.owesCents)}</span>
                </Tag>
              ) : null}
            </div>

            {narrow ? null : (
              <div className={`hidden font-mono text-xs lg:block ${r.crew && r.crew.filled < r.crew.required ? "font-semibold text-warn" : "text-muted"}`}>
                {r.crew && r.crew.required > 0 ? `${r.crew.filled}/${r.crew.required}` : ""}
              </div>
            )}

            <div className="hidden justify-self-end lg:block">
              {r.bookHref ? (
                <AppLink href={r.bookHref} className="btn-primary btn-sm relative z-10">
                  + Book
                </AppLink>
              ) : null}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

/** The rule under a row: none on the last, a firmer one where the departure time changes. */
function ruleBelow(r: ListRow, next: ListRow | undefined): string {
  if (next === undefined) return "";
  return next.time === r.time ? "border-b border-line" : "border-b border-faint/50";
}

function cruiseText(cruises: readonly string[]): string {
  if (cruises.length > 1) return `${cruises.length} cruises`;
  return cruises[0] ?? "";
}
