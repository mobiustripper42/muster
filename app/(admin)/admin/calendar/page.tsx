import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import {
  CalendarControls,
  CalendarEmptyNotice,
  CalendarError,
  CalendarGrid,
  CalendarLegend,
  HoldConfirm,
  loadCalendarData,
  type Search,
} from "./calendar-view";

/**
 * /admin/calendar (task 12.11, #464) — the Day·Grid reservation calendar: one day as a grid of
 * fleet vessels (columns) × a fixed 8:00–21:30 time axis, each computed departure drawn as a
 * block spanning its true duration (`docs/design/mockups/reservation-calendar-scale.html`,
 * "Day · Grid (A revised)"). The blocks registry links single-slot holds here ("On calendar →").
 *
 * A booked block links to `/admin/calendar/[reservationId]` (the detail pane). An OPEN block
 * takes the departure off the market as a single-slot hold, behind a confirm banner (#703); a
 * held one releases it. Selling from here is still deferred (it shares the 12.1 claim), as are
 * week/month views. Everything the two calendar routes share lives in `calendar-view.tsx`.
 */

export const dynamic = "force-dynamic";

export default async function AdminCalendar({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  const data = await loadCalendarData(sp);
  if (!data) {
    return (
      <Shell width="6xl">
        <Notice>Couldn’t reach the calendar right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  return (
    <Shell width="6xl">

      <header className="flex flex-col gap-1">
        <p className="text-xs text-faint">Calendar</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">Calendar</h1>
      </header>

      <CalendarError err={data.err} />

      <CalendarControls data={data} />
      <CalendarLegend data={data} />
      <HoldConfirm data={data} />

      {data.slots.length === 0 && <CalendarEmptyNotice day={data.day} />}

      <CalendarGrid data={data} />

      <VersionTag />
    </Shell>
  );
}
