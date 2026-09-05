import type { Event, Payment, Reservation, Vessel } from "@core/domain/entities.js";
import {
  buildPurchaseRows,
  filterByState,
  groupPaymentsByReservation,
  searchPurchases,
  stateCounts,
  type PaymentState,
} from "@core/reservations/purchases-view.js";
import { formatCents } from "@core/reservations/calendar-detail.js";
import { canonicalizePhone, formatPhoneForDisplay } from "@core/customers/identity.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../lib/swallowed";

/**
 * /admin/purchases (task 12.12a, #465) — the order list.
 *
 * An order IS a reservation, so this surface adds no new detail: every row links to the
 * calendar's existing `/admin/calendar/[reservationId]` pane. What's new is finding a booking by
 * PERSON — today the only route to one is knowing its date and clicking the right block on the
 * grid, which is useless when a customer calls and you have a name and a phone.
 *
 * Muster-side only: Xola owns its own money (DEC-105), so `xola` reservations never appear.
 * Read-only — refund is #472, message is #119. Search and filters are plain GET, so the page
 * stays server-rendered with no client JS.
 */

export const dynamic = "force-dynamic";

type Search = { q?: string; state?: string };

const STATES: { key: PaymentState | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unpaid", label: "Unpaid" },
  { key: "deposit", label: "Deposit" },
  { key: "paid", label: "Paid" },
  { key: "refunded", label: "Refunded" },
  // Live chargebacks AND ones we lost — both mean the money is not in the account (issue #723).
  // A dispute we WON is not here: the funds are back, the row reads Paid again, and this chip
  // stays a worklist that shrinks rather than an archive that only grows.
  { key: "disputed", label: "Disputed" },
  // A checkout in flight (14.3, SPEC §2.8.10). Its own chip so it never reads as Cancelled or
  // Unpaid; nothing writes one until 14.4, so the chip counts zero until then.
  { key: "pending", label: "Pending" },
  { key: "cancelled", label: "Cancelled" },
];

/** Badge styling per state — existing palette tokens only (DEC-021/042, no new colors). */
const BADGE: Record<PaymentState, string> = {
  paid: "border-ok-line bg-ok-bg text-ok",
  deposit: "border-warn-line bg-warn-bg text-warn",
  unpaid: "border-line bg-bg text-muted",
  refunded: "border-bad-line bg-bad-bg text-bad",
  // Same "bad" tokens as refunded — money that left the account, and no new colors (DEC-021/042).
  // The label carries the difference; a chargeback is not a worse-looking refund, it is a
  // different reason for the same missing money.
  disputed: "border-bad-line bg-bad-bg text-bad",
  // Same tokens as deposit — money is in motion, not missing and not lost.
  pending: "border-warn-line bg-warn-bg text-warn",
  cancelled: "border-line bg-bg text-faint",
};

/**
 * One phone format in the column. The reservation stores the phone as the customer typed it
 * ("216-555-0148", "+1 216 555 0148", "(440) 555-0102" all appear in real data), which reads as
 * three different formats stacked in one column. Canonicalize for display where we can; fall
 * back to the raw string rather than hiding a number we couldn't parse.
 */
function displayContact(phone: string | undefined, email: string | undefined): string {
  if (phone) {
    const canonical = canonicalizePhone(phone);
    return canonical.ok ? formatPhoneForDisplay(canonical.phone) : phone;
  }
  return email ?? "no contact";
}

/** "2026-08-12" → "Wed, Aug 12". */
function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function AdminPurchases({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  let reservations: Reservation[];
  let events: Event[];
  let payments: Payment[];
  let vessels: Vessel[];
  let taxRateBps: number;
  try {
    const repo = getRepo();
    const [r, e, p, v, config] = await Promise.all([
      repo.listAllReservations(),
      repo.listEvents(),
      repo.listAllPayments(),
      repo.listVessels(),
      repo.getPaymentConfig(),
    ]);
    reservations = r;
    events = e;
    payments = p;
    vessels = v;
    taxRateBps = config.taxRateBps;
  } catch (e) {
    logSwallowed("admin/purchases", e, "the order list, payments and tax rate did not load");
    return (
      <Shell width="3xl">
        <Notice>Couldn’t reach the order list right now. {ADMIN_LOG_HINT}</Notice>
      </Shell>
    );
  }

  const query = (sp.q ?? "").trim();
  const state = (STATES.find((s) => s.key === sp.state)?.key ?? "all") as PaymentState | "all";

  const allRows = buildPurchaseRows({
    reservations,
    eventsById: new Map(events.map((e) => [String(e.id), e])),
    paymentsByReservation: groupPaymentsByReservation(payments),
    vesselNameById: new Map(vessels.map((v) => [String(v.id), v.name])),
    taxRateBps,
  });
  const counts = stateCounts(allRows);
  const rows = searchPurchases(filterByState(allRows, state), query);

  /** Preserve the other axis on every chip (state ↔ query). */
  const hrefWith = (o: { state?: string; q?: string }): string => {
    const params = new URLSearchParams();
    const s = o.state ?? state;
    const q = o.q ?? query;
    if (s !== "all") params.set("state", s);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/admin/purchases?${qs}` : "/admin/purchases";
  };

  return (
    <Shell width="3xl">

      <header className="flex flex-col gap-1">
        <p className="text-xs text-faint">Bookings / Purchases</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">Purchases</h1>
      </header>

      <form method="get" className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search name, phone, email…"
          aria-label="Search orders"
          className="min-w-[220px] flex-1 rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-ink"
        />
        {/* Keep the active state filter when searching. */}
        {state !== "all" && <input type="hidden" name="state" value={state} />}
        <GetFormSubmit className="rounded-lg border border-line bg-ink px-3 py-1.5 text-sm font-medium text-white">
          Search
        </GetFormSubmit>
        {query && (
          <AppLink
            href={hrefWith({ q: "" })}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-muted"
          >
            Clear
          </AppLink>
        )}
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {STATES.map((s) => {
          const active = state === s.key;
          return (
            <AppLink
              key={s.key}
              href={hrefWith({ state: s.key })}
              aria-current={active ? "page" : undefined}
              data-testid={`state-${s.key}`}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                active ? "border-ink bg-ink font-medium text-white" : "border-line bg-card text-muted"
              }`}
            >
              {s.label} {counts[s.key]}
            </AppLink>
          );
        })}
      </div>

      {allRows.length === 0 && (
        <Notice>
          No Muster orders yet. Bookings sold through Xola aren’t listed here — Xola owns its own
          money, so its orders stay in Xola.
        </Notice>
      )}

      {allRows.length > 0 && rows.length === 0 && (
        <Notice>
          No order matches{query ? ` “${query}”` : ""} in this filter. Try All, or a partial name
          or phone.
        </Notice>
      )}

      {rows.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-card border border-line bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-faint">
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 font-semibold">Trip</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 font-semibold">Payment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.reservationId} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2">
                      {/* One reservation, two ways in — the detail is the calendar's pane. */}
                      <AppLink
                        href={`/admin/calendar/${encodeURIComponent(r.reservationId)}${
                          r.date ? `?date=${r.date}` : ""
                        }`}
                        className="font-semibold text-ink underline underline-offset-2"
                      >
                        {r.customerName}
                      </AppLink>
                      <div className="text-[11px] text-faint">
                        {displayContact(r.phone, r.email)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {r.date ? formatDay(r.date) : <span className="text-faint">—</span>}
                      {r.time && <span className="ml-1.5">{r.time}</span>}
                      <div className="text-[11px] text-faint">
                        {r.vesselName ? `${r.vesselName} · ` : ""}
                        {r.guestCount} guest{r.guestCount === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.priceKnown ? (
                        formatCents(r.totalCents)
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                      {/* Only when PART of it is paid — on an unpaid order the balance equals
                          the total and the badge already says so, so this would be noise. */}
                      {r.priceKnown && r.paidCents > 0 && r.balanceCents > 0 && (
                        <div className="text-[11px] font-normal text-muted">
                          {formatCents(r.balanceCents)} due
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        data-testid={`row-state-${r.reservationId}`}
                        className={`inline-block rounded border px-1.5 py-px text-[10px] uppercase tracking-wide ${BADGE[r.state]}`}
                      >
                        {r.state}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-2 text-xs text-faint">
        Total is fare + extra guests + tax. Tips aren’t included — they go to crew, not revenue.
        Refunds and messaging aren’t wired up here yet.
      </p>

      <VersionTag />
    </Shell>
  );
}
