import type { BalanceChargeAttempt, Event, Payment, Reservation, Vessel } from "@core/domain/entities.js";
import { resolveWindow } from "@core/admin/date-window.js";
import {
  buildPurchaseRows,
  groupPaymentsByReservation,
  ignoresWindow,
  listPurchases,
  purchasesHref,
  purchasesParams,
  type StateFilter,
  type PurchasesSearch,
} from "@core/reservations/purchases-view.js";
import { formatCents } from "@core/reservations/calendar-detail.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { GetFormSubmit } from "../../../../components/ui/get-form-submit";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { AutoSubmitSelect } from "../../../../components/admin/auto-submit-select";
import { DayList, DaySection } from "../../../../components/admin/day-heading";
import { PurchaseCard } from "../../../../components/admin/purchase-card";
import { WindowChips } from "../../../../components/admin/window-chips";
import type { Scope } from "../../../../components/admin/shifts-view-types";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../lib/swallowed";
import { Input } from "../../../../components/ui/input";
import { Card } from "../../../../components/ui/card";

/**
 * /admin/purchases (task 12.12a, #465) — the order list.
 *
 * An order IS a reservation, so this surface adds no new detail: every card links to the
 * calendar's existing `/admin/calendar/[reservationId]` pane. What's new is finding a booking by
 * PERSON — today the only route to one is knowing its date and clicking the right block on the
 * grid, which is useless when a customer calls and you have a name and a phone.
 *
 * Muster-side only: Xola owns its own money (DEC-105), so `xola` reservations never appear.
 * Read-only — refund is #472, message is #119. Search and filters are plain GET, so the page
 * stays server-rendered with no client JS beyond the status select.
 *
 * **Cards like All Shifts (issue #1285).** One card per booking under its trip day, soonest first,
 * the same at every width: search first, four date chips and one status dropdown. A card carries one
 * amount — what the customer still owes. The composition lives in `listPurchases`; every href goes
 * through `purchasesHref`, so changing one control keeps the rest.
 */

export const dynamic = "force-dynamic";

type Search = PurchasesSearch;

/** The date chips, in order. `past` and `all` are this page's own. */
const PRESETS: readonly Scope[] = ["next7", "days30", "past", "all"];

const STATES: { key: StateFilter; label: string }[] = [
  { key: "all", label: "All statuses" },
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
  // A dispute we WON is not here: the funds are back, the row reads Paid again, and this entry
  // stays a worklist that shrinks rather than an archive that only grows.
  { key: "disputed", label: "Disputed" },
  // A checkout in flight (14.3, SPEC §2.8.10). Its own entry so it never reads as Cancelled or
  // Unpaid; nothing writes one until 14.4, so it counts zero until then.
  { key: "pending", label: "Pending" },
  { key: "cancelled", label: "Cancelled" },
];

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
  try {
    const repo = getRepo();
    const [r, e, p, v, a] = await Promise.all([
      repo.listAllReservations(),
      repo.listEvents(),
      repo.listAllPayments(),
      repo.listVessels(),
      repo.listAllBalanceAttempts(),
    ]);
    reservations = r;
    events = e;
    payments = p;
    vessels = v;
    attempts = a;
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
  const now = new Date();
  const window = resolveWindow(sp, now, { allowPast: true, allowAll: true });
  // A search, or Balance due, covers every date — the window then names nothing the list shows.
  const everyDate = ignoresWindow(state, query);
  const scope = everyDate ? resolveWindow({ preset: "all" }, now, { allowAll: true }).scope : window.scope;

  const attemptsByReservation = new Map<string, BalanceChargeAttempt[]>();
  for (const a of attempts) {
    const k = String(a.reservationId);
    (attemptsByReservation.get(k) ?? attemptsByReservation.set(k, []).get(k)!).push(a);
  }
  const allRows = buildPurchaseRows({
    reservations,
    eventsById: new Map(events.map((e) => [String(e.id), e])),
    paymentsByReservation: groupPaymentsByReservation(payments),
    vesselById: new Map(vessels.map((v) => [String(v.id), { name: v.name, hue: v.hue }])),
    attemptsByReservation,
    now: now.toISOString(),
  });
  const { counts, groups, windowEmpty } = listPurchases(allRows, { q: query, state, window });
  const cards = groups.reduce((n, g) => n + g.rows.length, 0);

  // What the controls carry. The raw window params ride along, so an explicit `preset=next7` stays
  // in the URL and the bare default carries none; `state` is the validated one.
  const current: PurchasesSearch = { q: query, state, preset: sp.preset, from: sp.from, to: sp.to };
  const href = (change: Partial<PurchasesSearch>) => purchasesHref(current, change);

  return (
    <Shell width="3xl">

      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted">Bookings / Purchases</p>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">Purchases</h1>
      </header>

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
        {/* Keep the window and status when searching. */}
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

      <Card className="mt-3 flex flex-col gap-2">
        <WindowChips
          // A search and Balance due ignore the window, so no date chip is lit there; `kind` only
          // lights a chip.
          kind={everyDate ? "range" : window.kind}
          from={window.from}
          to={window.to}
          presets={PRESETS}
          hrefFor={(preset) => href({ preset })}
          // No window key: a carried preset would beat the range the form submits. Passed as a window
          // change, so a submitted range drops the search and leaves Balance due as a chip does.
          hidden={
            <HiddenFields
              params={purchasesParams(current, { preset: undefined, from: undefined, to: undefined })}
            />
          }
          submitLabel="Apply"
          open={window.kind === "range"}
          filter={
            // Picking a status keeps the dates and the search: they ride along as hidden fields, and
            // the empty option carries no `state`.
            <form method="get" className="text-sm">
              <HiddenFields params={purchasesParams(current, { state: undefined })} />
              <AutoSubmitSelect
                name="state"
                value={state === "all" ? "" : state}
                includeEmpty={`All statuses (${counts.all})`}
                options={STATES.filter((s) => s.key !== "all").map((s) => ({
                  value: s.key,
                  label: `${s.label} (${counts[s.key]})`,
                }))}
                density="dense"
                className="w-full sm:w-auto"
                ariaLabel="Status"
              />
            </form>
          }
        />
      </Card>

      {allRows.length === 0 && (
        <Notice>
          No Muster orders yet. Bookings sold through Xola aren’t listed here — Xola owns its own
          money, so its orders stay in Xola.
        </Notice>
      )}

      {allRows.length > 0 && groups.length === 0 && query && (
        <Notice data-testid="empty-search">
          No booking matches “{query}”. Try All statuses, or part of a name or phone.
        </Notice>
      )}
      {allRows.length > 0 && groups.length === 0 && !query && windowEmpty && (
        <Notice data-testid="empty-window">No results returned</Notice>
      )}
      {allRows.length > 0 && groups.length === 0 && !query && !windowEmpty && (
        <Notice data-testid="empty-status">No bookings with this status.</Notice>
      )}

      {groups.length > 0 && (
        <DayList caption={`${cards} booking${cards === 1 ? "" : "s"} · ${scope}`}>
          {groups.map((g) => (
            <DaySection
              key={g.key}
              label={g.label}
              aside={g.owedCents > 0 ? `${formatCents(g.owedCents)} still owed` : undefined}
            >
              {g.rows.map((r) => (
                <PurchaseCard
                  key={r.reservationId}
                  row={r}
                  href={`/admin/calendar/${encodeURIComponent(r.reservationId)}${r.date ? `?date=${r.date}` : ""}`}
                />
              ))}
            </DaySection>
          ))}
        </DayList>
      )}
    </Shell>
  );
}
