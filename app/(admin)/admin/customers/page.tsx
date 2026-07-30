import type { Customer, Event, Reservation } from "@core/domain/entities.js";
import { formatPhoneForDisplay } from "@core/customers/identity.js";
import { buildCustomerRows, filterCustomerRows } from "@core/customers/customer-view.js";
import { formatCents } from "@core/reservations/calendar-detail.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * /admin/customers (task 12.12b, #465) — the contact list (DEC-123 §3, DEC-132).
 *
 * A customer is a CONTACT RECORD, not an account: no login, no password, nothing to
 * authenticate. This surface answers "who is this person and what have they booked" — the
 * money view of an individual order is the reservation detail pane on the calendar.
 *
 * Read-only in this slice. "Edit contact" defers; "Message" is blocked on #119 (a customer must
 * never text the crew line — it needs the second sender number). Search is a plain GET form, so
 * the page stays server-rendered with no client JS.
 */

export const dynamic = "force-dynamic";

type Search = { q?: string };

export default async function AdminCustomers({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  let customers: Customer[];
  let reservations: Reservation[];
  let events: Event[];
  try {
    const repo = getRepo();
    [customers, reservations, events] = await Promise.all([
      repo.listCustomers(),
      repo.listAllReservations(),
      repo.listEvents(),
    ]);
  } catch {
    return (
      <Shell width="3xl">
        <Notice>Couldn’t reach the customer list right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  const query = (sp.q ?? "").trim();
  const eventsById = new Map(events.map((e) => [String(e.id), e]));
  const allRows = buildCustomerRows(customers, reservations, eventsById);
  const rows = filterCustomerRows(allRows, query);

  return (
    <Shell width="3xl">

      <header className="flex flex-col gap-1">
        <p className="text-xs text-faint">Bookings / Customers</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">Customers</h1>
      </header>

      {/* Plain GET form — server-rendered search, no client JS. */}
      <form method="get" className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search name, phone, email, code…"
          aria-label="Search customers"
          className="min-w-[240px] flex-1 rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-ink"
        />
        <GetFormSubmit className="rounded-lg border border-line bg-ink px-3 py-1.5 text-sm font-medium text-white">
          Search
        </GetFormSubmit>
        {query && (
          <AppLink
            href="/admin/customers"
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-muted"
          >
            Clear
          </AppLink>
        )}
        <span className="text-xs text-faint">
          {query ? `${rows.length} of ${allRows.length}` : `${allRows.length} total`}
        </span>
      </form>

      {allRows.length === 0 && (
        <Notice>
          No customers yet. A customer record is created the first time someone books with a phone
          number — run <code>npm run db:backfill:customers</code> to build them from existing
          reservations.
        </Notice>
      )}

      {allRows.length > 0 && rows.length === 0 && (
        <Notice>No customer matches “{query}”. Try a partial name, phone, or code.</Notice>
      )}

      {rows.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-card border border-line bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-faint">
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Contact</th>
                  <th className="px-3 py-2 text-right font-semibold">Bookings</th>
                  <th className="px-3 py-2 text-right font-semibold">Lifetime</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2">
                      <AppLink
                        href={`/admin/customers/${encodeURIComponent(r.id)}`}
                        className="font-semibold text-ink underline underline-offset-2"
                      >
                        {r.name}
                      </AppLink>
                      <div className="font-mono text-[10.5px] text-faint">{r.displayCode}</div>
                      {!r.active && (
                        <div className="text-[10px] uppercase tracking-wide text-muted">Retired</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      <div className="font-mono">{formatPhoneForDisplay(r.phoneE164)}</div>
                      {r.email && <div className="break-all">{r.email}</div>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.bookingCount}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCents(r.lifetimeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lifetime excludes tips on purpose — say so, so the number isn't misread as "collected". */}
      <p className="mt-2 text-xs text-faint">
        Lifetime is fare + extra guests on booked trips. Tips go to crew and are never counted as
        revenue; tax and payment status aren’t included either.
      </p>

      <VersionTag />
    </Shell>
  );
}
