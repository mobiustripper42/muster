import type { BalanceChargeAttempt, Event, Payment, Reservation, Vessel } from "@core/domain/entities.js";
import type { TrailEvent } from "@core/domain/reservation-trail.js";
import { resolveWindow } from "@core/admin/date-window.js";
import {
  bookedAtByReservation,
  buildPurchaseRows,
  groupPaymentsByReservation,
  listPurchases,
  purchasesHref,
  purchasesParams,
  type PaymentState,
  type PurchaseOwed,
  type StateFilter,
  type PurchasesSearch,
} from "@core/reservations/purchases-view.js";
import { formatCents } from "@core/reservations/calendar-detail.js";
import { formatShortDay } from "@core/reservations/availability-screen.js";
import { dueDayLabel } from "@core/reservations/checkout-quote.js";
import { canonicalizePhone, formatPhoneForDisplay } from "@core/customers/identity.js";
import { Notice } from "../../../../components/ui/notice";
import { Badge, type Tone } from "../../../../components/ui/badge";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { WindowChips } from "../../../../components/admin/window-chips";
import type { Scope } from "../../../../components/admin/shifts-view-types";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../lib/swallowed";
import { Input } from "../../../../components/ui/input";
import { Card } from "../../../../components/ui/card";
import { chipLook } from "../../../../components/ui/choice";

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
 *
 * **The All Shifts of reservations (issue #1142).** A date window with the same preset chips
 * (`resolveWindow`, shared with All Shifts), rows grouped under day headings, a second sort by when
 * it was bought, and an Owed column — the morning check on balances. The composition lives in
 * `listPurchases`; every href goes through `purchasesHref`, so changing one control keeps the rest.
 */

export const dynamic = "force-dynamic";

type Search = PurchasesSearch;

/** The window chips, in order. `past` and `all` are this page's own. */
const PRESETS: readonly Scope[] = ["today", "weekend", "next7", "next8to15", "days30", "past", "all"];

const STATES: { key: StateFilter; label: string }[] = [
  { key: "all", label: "All" },
  // Phone bookings holding a boat until the customer pays the link (issue #1082 part C, SPEC
  // §2.10.6). Second, after All: it is the operator's chase list, the one they work daily.
  { key: "awaiting", label: "Awaiting payment" },
  // Every deposit balance still to be charged, whatever the booking's state and wherever its trip
  // falls — the morning worklist (issue #1142). Not a payment state: see `listPurchases`.
  { key: "balance_due", label: "Balance due" },
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

/** Badge tone per state — existing palette tokens only (DEC-021/042, no new colors). */
const BADGE: Record<PaymentState, Tone> = {
  // Same tone as deposit and pending — money is owed and expected, not missing.
  awaiting: "warn",
  paid: "ok",
  deposit: "warn",
  unpaid: "neutral",
  refunded: "bad",
  // Same "bad" tone as refunded — money that left the account, and no new colors (DEC-021/042).
  // The label carries the difference; a chargeback is not a worse-looking refund, it is a
  // different reason for the same missing money.
  disputed: "bad",
  // Same tone as deposit — money is in motion, not missing and not lost.
  pending: "warn",
  cancelled: "neutral",
};

/** What the badge says. The state's own word, except where one word would mislead: "awaiting" on
 *  its own doesn't say what for. */
const BADGE_TEXT: Partial<Record<PaymentState, string>> = { awaiting: "awaiting payment" };

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

/** A querystring's pairs as hidden inputs — what a GET form carries to keep the other controls. */
function HiddenFields({ params }: { params: URLSearchParams }) {
  return (
    <>
      {[...params].map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

/** The Owed column: the amount over when it is due, or over `past due` in the bad tone. The amount
 *  alone when the booking has no due date (an unpaid row); blank when nothing is owed. */
function OwedCell({ owed, labelled = false }: { owed: PurchaseOwed; labelled?: boolean }) {
  return (
    <>
      {/* `labelled` is the phone-width copy under Total, where no column header names the figure. */}
      {labelled ? `owed ${formatCents(owed.cents)}` : formatCents(owed.cents)}
      {owed.dueAt &&
        (owed.pastDue ? (
          <div className="whitespace-nowrap text-[11px] font-normal text-bad">
            past due{owed.lastFailure ? ` · ${owed.lastFailure}` : ""}
          </div>
        ) : (
          <div className="whitespace-nowrap text-[11px] font-normal text-muted">due {dueDayLabel(owed.dueAt)}</div>
        ))}
    </>
  );
}

/** The day heading: `Wednesday, Oct 21 · 4 bookings · $2,611.76 · $552.94 still owed`. */
function groupHeading(g: { label: string; count: number; totalCents: number; owedCents: number }): string {
  const parts = [g.label, `${g.count} booking${g.count === 1 ? "" : "s"}`, formatCents(g.totalCents)];
  if (g.owedCents > 0) parts.push(`${formatCents(g.owedCents)} still owed`);
  return parts.join(" · ");
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
  let attempts: BalanceChargeAttempt[];
  let trail: TrailEvent[];
  try {
    const repo = getRepo();
    const [r, e, p, v, a, t] = await Promise.all([
      repo.listAllReservations(),
      repo.listEvents(),
      repo.listAllPayments(),
      repo.listVessels(),
      repo.listAllBalanceAttempts(),
      repo.listTrailEvents(),
    ]);
    reservations = r;
    events = e;
    payments = p;
    vessels = v;
    attempts = a;
    trail = t;
  } catch (e) {
    logSwallowed("admin/purchases", e, "the order list or payments did not load");
    return (
      <Shell width="3xl">
        <Notice>Couldn’t reach the order list right now. {ADMIN_LOG_HINT}</Notice>
      </Shell>
    );
  }

  const query = (sp.q ?? "").trim();
  const state = STATES.find((x) => x.key === sp.state)?.key ?? "all";
  const sort = sp.sort === "purchase" ? "purchase" : "trip";
  const now = new Date();
  const window = resolveWindow(sp, now, { allowPast: true, allowAll: true });

  const attemptsByReservation = new Map<string, BalanceChargeAttempt[]>();
  for (const a of attempts) {
    const k = String(a.reservationId);
    (attemptsByReservation.get(k) ?? attemptsByReservation.set(k, []).get(k)!).push(a);
  }
  const allRows = buildPurchaseRows({
    reservations,
    eventsById: new Map(events.map((e) => [String(e.id), e])),
    paymentsByReservation: groupPaymentsByReservation(payments),
    vesselNameById: new Map(vessels.map((v) => [String(v.id), v.name])),
    bookedAtByReservation: bookedAtByReservation(trail),
    attemptsByReservation,
    now: now.toISOString(),
  });
  const { counts, groups, windowEmpty } = listPurchases(allRows, { q: query, state, window, sort });

  // What the controls carry. The raw window params ride along, so an explicit `preset=next7` stays
  // in the URL and the bare default carries none; `state` and `sort` are the validated ones.
  const current: PurchasesSearch = { q: query, state, preset: sp.preset, from: sp.from, to: sp.to, sort };
  const href = (change: Partial<PurchasesSearch>) => purchasesHref(current, change);
  const sortChip = (active: boolean) => `pressable ${chipLook(active, "dense")}`;

  return (
    <Shell width="3xl">

      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted">Bookings / Purchases</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">Purchases</h1>
      </header>

      <Card className="mt-3 flex flex-col gap-2">
        <WindowChips
          // Balance due ignores the window, so no preset chip is lit there; `kind` only lights a chip.
          kind={state === "balance_due" ? "range" : window.kind}
          from={window.from}
          to={window.to}
          presets={PRESETS}
          hrefFor={(preset) => href({ preset })}
          // No window key: a carried preset would beat the range the form submits. Passed as a window
          // change, so a submitted range leaves Balance due as a window chip does.
          hidden={
            <HiddenFields
              params={purchasesParams(current, { preset: undefined, from: undefined, to: undefined })}
            />
          }
          submitLabel="Apply"
          open={window.kind === "range"}
        />
      </Card>

      <form method="get" className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search name, phone, email…"
          aria-label="Search orders"
          density="dense"
          className="min-w-[220px] flex-1"
        />
        {/* Keep the window, state and sort when searching. */}
        <HiddenFields params={purchasesParams(current, { q: undefined })} />
        <GetFormSubmit className="btn-primary btn-sm">
          Search
        </GetFormSubmit>
        {query && (
          <AppLink
            href={href({ q: "" })}
            className="btn-secondary btn-sm"
          >
            Clear
          </AppLink>
        )}
      </form>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {STATES.map((s) => {
            const active = state === s.key;
            return (
              <AppLink
                key={s.key}
                href={href({ state: s.key })}
                aria-current={active ? "page" : undefined}
                data-testid={`state-${s.key}`}
                className={`pressable ${chipLook(active, "dense")}`}
              >
                {s.label} {counts[s.key]}
              </AppLink>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <AppLink
            href={href({ sort: "trip" })}
            aria-current={sort === "trip" ? "page" : undefined}
            data-testid="sort-trip"
            className={sortChip(sort === "trip")}
          >
            By trip
          </AppLink>
          <AppLink
            href={href({ sort: "purchase" })}
            aria-current={sort === "purchase" ? "page" : undefined}
            data-testid="sort-purchase"
            className={sortChip(sort === "purchase")}
          >
            By purchase
          </AppLink>
        </div>
      </div>

      {allRows.length === 0 && (
        <Notice>
          No Muster orders yet. Bookings sold through Xola aren’t listed here — Xola owns its own
          money, so its orders stay in Xola.
        </Notice>
      )}

      {windowEmpty && <Notice>No results returned</Notice>}

      {allRows.length > 0 && !windowEmpty && groups.length === 0 && (
        <Notice>
          No order matches{query ? ` “${query}”` : ""} in this filter. Try All, or a partial name
          or phone.
        </Notice>
      )}

      {groups.length > 0 && (
        <Card pad="none" className="mt-2 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 font-semibold">Trip</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  {/* Below `sm`, Owed rides under Total and the badge in the Customer cell: five
                      columns ran past a 375px screen with nothing to say the table scrolls. */}
                  <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Owed</th>
                  <th className="hidden px-3 py-2 font-semibold sm:table-cell">Payment</th>
                </tr>
              </thead>
              {groups.map((g) => (
              <tbody key={g.key}>
                <tr className="border-b border-line bg-bg">
                  <th
                    colSpan={5}
                    scope="colgroup"
                    className="px-3 py-1.5 text-left text-xs font-semibold text-ink"
                  >
                    {groupHeading(g)}
                  </th>
                </tr>
                {g.rows.map((r) => (
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
                      <div className="whitespace-nowrap text-[11px] text-muted">
                        {displayContact(r.phone, r.email)}
                      </div>
                      {/* The phone-width copy of the Payment column's badge. No test id: the
                          column's badge carries it, so a count of badges is one per row. */}
                      <div className="mt-1 sm:hidden">
                        <Badge tone={BADGE[r.state]}>{BADGE_TEXT[r.state] ?? r.state}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      <span className="whitespace-nowrap">
                        {r.date ? formatShortDay(r.date) : <span className="text-muted">—</span>}
                        {r.time && <span className="ml-1.5">{r.time}</span>}
                      </span>
                      <div className="text-[11px] text-muted">
                        {r.vesselName ? `${r.vesselName} · ` : ""}
                        {r.guestCount} guest{r.guestCount === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.priceKnown ? (
                        formatCents(r.totalCents)
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {/* The phone-width copy of the Owed column. No test id, as the badge copy. */}
                      {r.owed && (
                        <div className="mt-1 text-[11px] sm:hidden">
                          <OwedCell owed={r.owed} labelled />
                        </div>
                      )}
                    </td>
                    <td
                      className="hidden px-3 py-2 text-right font-mono sm:table-cell"
                      data-testid={`owed-${r.reservationId}`}
                    >
                      {r.owed && <OwedCell owed={r.owed} />}
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      <Badge data-testid={`row-state-${r.reservationId}`} tone={BADGE[r.state]}>
                        {BADGE_TEXT[r.state] ?? r.state}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
              ))}
            </table>
          </div>
        </Card>
      )}

      <VersionTag />
    </Shell>
  );
}
