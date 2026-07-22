import { notFound } from "next/navigation";
import type { Event, Reservation } from "@core/domain/entities.js";
import { asId } from "@core/domain/ids.js";
import { formatPhoneForDisplay } from "@core/customers/identity.js";
import { buildCustomerDetail } from "@core/customers/customer-view.js";
import { formatCents } from "@core/reservations/calendar-detail.js";
import { BackLink } from "../../../../../components/ui/back-link";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { AppLink } from "../../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../../components/admin/admin-signed-out";
import { VersionTag } from "../../../../../components/ui/version-tag";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";

/**
 * /admin/customers/[customerId] (task 12.12b, #465) — one contact record + booking history.
 *
 * Read-only (DEC-132): "Edit contact" defers, and "Message" is blocked on #119 — a customer must
 * never text the crew line, so it needs the second sender number first. Each history row links
 * to that reservation's detail on the calendar, which is the money view of a single booking.
 */

export const dynamic = "force-dynamic";

/** Decode a path segment, tolerating a malformed `%` rather than 500ing at the user. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** "2026-07-18" → "Sat Jul 18". */
function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId: rawId } = await params;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  const customerId = asId<"CustomerId">(safeDecode(rawId));

  let customer: Awaited<ReturnType<ReturnType<typeof getRepo>["getCustomer"]>>;
  let reservations: Reservation[];
  let events: Event[];
  try {
    const repo = getRepo();
    customer = await repo.getCustomer(customerId);
    if (!customer) notFound();
    [reservations, events] = await Promise.all([
      repo.listReservationsForCustomer(customerId),
      repo.listEvents(),
    ]);
  } catch (e) {
    // `notFound()` throws a control-flow signal — never swallow it into the error notice.
    if (e && typeof e === "object" && "digest" in e) throw e;
    return (
      <Shell width="3xl">
        <Notice>Couldn’t load this customer right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const eventsById = new Map(events.map((e) => [String(e.id), e]));
  const v = buildCustomerDetail(customer, reservations, eventsById);

  return (
    <Shell width="3xl">
      <BackLink href="/admin/customers">Customers</BackLink>

      <header className="flex flex-col gap-1">
        <p className="text-xs text-faint">Reservations / Customers / Contact</p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] font-semibold leading-tight text-ink">{v.name}</h1>
          <span className="font-mono text-xs text-faint">{v.displayCode}</span>
          {!v.active && (
            <span className="rounded border border-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">
              Retired
            </span>
          )}
        </div>
      </header>

      <div className="mt-3 overflow-hidden rounded-card border border-line bg-card shadow-sm">
        <div className="border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink">
            <span className="font-mono">{formatPhoneForDisplay(v.phoneE164)}</span>
            {v.email ? (
              <span className="break-all font-mono text-[13px]">{v.email}</span>
            ) : (
              <span className="text-faint">No email</span>
            )}
          </div>
          <div className="mt-1 text-xs text-faint">
            {v.bookingCount} booking{v.bookingCount === 1 ? "" : "s"} ·{" "}
            {formatCents(v.lifetimeCents)} lifetime · since {v.createdAt.slice(0, 10)}
          </div>
          {v.notes && <p className="mt-2 text-sm text-muted">{v.notes}</p>}
        </div>

        <div className="px-4 py-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
            History
          </div>
          {v.history.length === 0 ? (
            <p className="py-2 text-sm text-muted">No bookings on this contact yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {v.history.map((h) => (
                <li key={h.reservationId} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-sm text-ink">
                    {h.date ? formatDay(h.date) : <span className="text-faint">Unknown date</span>}
                    {h.time && <span className="ml-1.5 text-xs text-muted">{h.time}</span>}
                    <span className="ml-2 text-xs text-faint">
                      {h.guestCount} guest{h.guestCount === 1 ? "" : "s"}
                    </span>
                    {h.status === "cancelled" && (
                      <span className="ml-2 rounded border border-line px-1 py-px text-[10px] uppercase tracking-wide text-muted">
                        Cancelled
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    <span
                      className={`font-mono text-sm ${h.status === "cancelled" ? "text-faint" : "text-ink"}`}
                    >
                      {formatCents(h.valueCents)}
                    </span>
                    {/* The money view of one booking lives on the calendar's detail pane. */}
                    <AppLink
                      href={`/admin/calendar/${encodeURIComponent(h.reservationId)}${
                        h.date ? `?date=${h.date}` : ""
                      }`}
                      className="text-xs text-accent underline underline-offset-2"
                    >
                      Open
                    </AppLink>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-faint">
        A contact record, not an account — customers never sign in. Editing and messaging aren’t
        wired up yet; messaging waits on a separate customer sender number so a customer can never
        text the crew line.
      </p>

      <VersionTag />
    </Shell>
  );
}
