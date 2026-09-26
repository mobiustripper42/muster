import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { MasterDetail } from "../../../../components/admin/master-detail";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import {
  CalendarControls,
  CalendarEmptyNotice,
  CalendarError,
  CalendarGrid,
  CalendarLegend,
  SlotPane,
  calendarHref,
  loadCalendarData,
  type Search,
} from "./calendar-view";

/**
 * /admin/calendar (task 12.11, #464) — the Day·Grid reservation calendar: one day as a grid of
 * fleet vessels (columns) × a fixed 8:00–21:30 time axis, each computed departure drawn as a
 * block spanning its true duration (`docs/design/mockups/reservation-calendar-scale.html`,
 * "Day · Grid (A revised)"). The blocks registry links single-slot holds here ("On calendar →").
 *
 * **Every card opens a pane (#1104).** A booked block links to `/admin/calendar/[reservationId]`;
 * an OPEN or BLOCKED block opens its slot's pane beside the grid, in the same list-and-detail
 * frame (`MasterDetail`) — where Book it, Block it and Unblock it live. Nothing selected, the grid
 * has the page to itself. Everything the two calendar routes share lives in `calendar-view.tsx`.
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

  const calendar = (
    <>
      <CalendarError err={data.err} />
      <CalendarControls data={data} />
      <CalendarLegend data={data} />
      {data.slots.length === 0 && <CalendarEmptyNotice day={data.day} />}
      <CalendarGrid data={data} />
    </>
  );

  return (
    <Shell width="6xl">
      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted">Calendar</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">Calendar</h1>
      </header>

      {data.pending ? (
        <MasterDetail
          layout="calendar"
          list={calendar}
          pane={<SlotPane data={data} />}
          closeHref={calendarHref(data, {})}
          back={{ href: calendarHref(data, {}), label: "Back to calendar" }}
        />
      ) : (
        calendar
      )}

      <VersionTag />
    </Shell>
  );
}
