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
import { BookPane, type BookSearch } from "./book-pane";

/**
 * /admin/calendar (task 12.11, #464) — the Day·Grid reservation calendar: one day as a grid of
 * fleet vessels (columns) × a fixed 8:00–21:30 time axis, each computed departure drawn as a
 * block spanning its true duration (`docs/design/mockups/reservation-calendar-scale.html`,
 * "Day · Grid (A revised)"). The blocks registry links single-slot holds here ("On calendar →").
 *
 * **Every card opens a pane (#1104).** A booked block links to `/admin/calendar/[reservationId]`;
 * an OPEN or BLOCKED block opens its slot's pane beside the grid, in the same list-and-detail
 * frame (`MasterDetail`) — where Book it, Block it and Unblock it live. Book it turns that pane into
 * the phone booking's two steps (`BookPane`, `?book=1`, issue #1104 part 3), the grid still beside
 * it. Nothing selected, the grid has the page to itself. Everything the two calendar routes share lives in `calendar-view.tsx`.
 */

export const dynamic = "force-dynamic";

export default async function AdminCalendar({
  searchParams,
}: {
  searchParams: Promise<Search & BookSearch>;
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

  // `fill` with a pane open: the grid's box scrolls under pinned controls (issue #1128).
  const calendar = (fill: boolean) => (
    <>
      <CalendarError err={data.err} />
      <CalendarControls data={data} />
      <CalendarLegend data={data} />
      {data.slots.length === 0 && <CalendarEmptyNotice day={data.day} />}
      <CalendarGrid data={data} fill={fill} />
    </>
  );

  return (
    // `fill` only with a pane open: then the grid and the pane each scroll on their own and the
    // window doesn't (as /admin/shifts). With nothing selected the grid has the page and it scrolls.
    <Shell width="6xl" fill={data.pending !== null}>
      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted">Calendar</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">Calendar</h1>
      </header>

      {data.pending ? (
        <MasterDetail
          layout="calendar"
          list={calendar(true)}
          pane={
            data.pending.action === "hold" && sp.book === "1" ? (
              <BookPane data={data} sp={sp} />
            ) : (
              <SlotPane data={data} />
            )
          }
          closeHref={calendarHref(data, {})}
          back={{ href: calendarHref(data, {}), label: "Back to calendar" }}
          listTestId="cal-list-col"
          paneTestId="cal-pane-col"
        />
      ) : (
        calendar(false)
      )}

      <VersionTag />
    </Shell>
  );
}
