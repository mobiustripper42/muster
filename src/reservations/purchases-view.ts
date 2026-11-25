/**
 * Purchases (order) list view model (12.12a, #465) — the money view of the reservation set.
 *
 * **An order IS a reservation.** One order = one boat = one reservation (operator, 2026-07-17),
 * so there is no separate order entity to build and no order-number scheme — the mockup's
 * `BRW-4821` has no source in the model, and the operator decided a human order number isn't
 * worth inventing yet. Rows key on the reservation id.
 *
 * This surface deliberately does NOT rebuild the detail pane. The calendar's
 * `/admin/calendar/[reservationId]` already renders one booking's money, and the mockup says so
 * itself: "the same detail the reservation-calendar pane shows, here keyed by order instead of
 * departure." What's genuinely new is the LIST — finding a booking by person rather than by
 * knowing its date and clicking the right block on a grid.
 *
 * **Payment state is derived, never stored** — same posture as `balanceOwedCents` (DEC-107): a
 * stored status would drift the moment a payment or refund landed.
 */

import { fmtDayHeader, windowParams, type Scope } from "../admin/date-window.js";
import type { BalanceChargeAttempt, Event, Payment, Reservation } from "../domain/entities.js";
import { balanceDueCents, countsAsPaid } from "./payment-config.js";

/**
 * The mockup shows three states (Paid / Deposit / Refunded). Real data needs two more:
 *
 * - `unpaid` — a booked reservation with NO succeeded payment. The mockup never drew it, but
 *   it exists (Xola-era rows, seeded demo data, a booking whose webhook hasn't landed). Folding
 *   it into `deposit` would tell the operator money arrived when none did — the one error this
 *   list must not make.
 * - `cancelled` — the reservation's own status, which outranks any payment state for display.
 *   A cancelled booking showing "Paid" reads like a live order.
 * - `pending` (14.3, SPEC §2.8.10) — a checkout in flight, money not yet taken. Its own word:
 *   it is not `cancelled` (nobody cancelled anything) and not `unpaid` (that is a BOOKED row
 *   whose payment never landed — a defect, where this is a state). Lapsed is not distinguishable
 *   here until the row carries a reserved time (14.4).
 * - `awaiting` (issue #1082 part C, SPEC §2.10.6) — an operator's phone booking, holding the boat
 *   until the customer pays the link. Not `pending`: that is a web checkout that lapses in minutes,
 *   where this holds until a person acts, and the operator works this list to chase it. Named for
 *   "boat held, money owed" so deposit balances can join it when deposits return.
 */
export type PaymentState =
  | "awaiting"
  | "pending"
  | "cancelled"
  | "disputed"
  | "refunded"
  | "paid"
  | "deposit"
  | "unpaid";

/** A state chip: a payment state, `all`, or `balance_due` — which is not a state, because a balance
 *  due is a fact across several of them (issue #1142). */
export type StateFilter = PaymentState | "all" | "balance_due";

/**
 * Does this view cover every date? The one home for the rule (issue #1285): Balance due is a worklist
 * and must not hide a balance because its trip is 31 days out, and a search finds a booking
 * whatever day it is on. A `q` of only spaces is not a search. `listPurchases`, the page's lit-chip
 * rule and its caption all ask this.
 */
export function ignoresWindow(state: StateFilter, q: string): boolean {
  return state === "balance_due" || q.trim() !== "";
}

export interface PurchaseRow {
  reservationId: string;
  customerName: string;
  /** Contact for search — the card draws neither. */
  phone?: string | undefined;
  email?: string | undefined;
  /** Departure date/time, or undefined when the event row is missing. */
  date?: string | undefined;
  time?: string | undefined;
  offeringName?: string | undefined;
  vesselId?: string | undefined;
  vesselName?: string | undefined;
  /** The vessel's stored colour hue, when it has one (DEC-086). */
  vesselHue?: number | undefined;
  guestCount: number;
  /** Σ succeeded payments, gross of any bundled tip — what the card actually took. */
  paidCents: number;
  balanceCents: number;
  refundedCents: number;
  state: PaymentState;
  /**
   * What the customer still owes, or absent when nothing is (issue #1285): a deposit's balance, or
   * the whole invoice of a booking with nothing paid (`unpaid`, `awaiting`). Absent when paid in
   * full, cancelled, disputed, or a web checkout in flight.
   */
  owed?: PurchaseOwed | undefined;
}

/** Where an owed balance stands: not yet due, or — from the due instant — what became of the charge. */
export type PurchaseOwedStatus = "due" | "past_due" | "needs_approval" | "declined";

export interface PurchaseOwed {
  cents: number;
  /** The booking's `balanceDueAt`; only a deposit's or a refunded booking's balance carries one. */
  dueAt?: string | undefined;
  /** Set exactly when `dueAt` is. */
  status?: PurchaseOwedStatus | undefined;
}

export interface PurchasesInput {
  reservations: readonly Reservation[];
  eventsById: ReadonlyMap<string, Event>;
  paymentsByReservation: ReadonlyMap<string, Payment[]>;
  offeringNameByEventId?: ReadonlyMap<string, string> | undefined;
  vesselById?: ReadonlyMap<string, { name: string; hue?: number | undefined }> | undefined;
  /** Reservation id → its balance charge attempts. */
  attemptsByReservation?: ReadonlyMap<string, BalanceChargeAttempt[]> | undefined;
  /** The list's clock, an ISO instant — an owed balance's `status` is judged against it. */
  now: string;
}

/** Group a flat payment list by reservation — the one pass a list page needs. */
export function groupPaymentsByReservation(
  payments: readonly Payment[],
): Map<string, Payment[]> {
  const out = new Map<string, Payment[]>();
  for (const p of payments) {
    const k = String(p.reservationId);
    (out.get(k) ?? out.set(k, []).get(k)!).push(p);
  }
  return out;
}

/**
 * Does this booking have a chargeback against it — live or lost? (issue #723)
 *
 * **`won` is deliberately not a state here.** A dispute we win puts the money back and the
 * payment row returns to `succeeded`, so the row reads `paid` again and drops off the Disputed
 * filter. That is what makes the filter a worklist rather than an archive: everything on it
 * needs a human, and it shrinks as they deal with it. The consequence is real and worth stating
 * — once won, Muster keeps no trace the dispute happened; the history lives in the Stripe
 * dashboard, which is the system of record for the dispute itself. Keeping won ones visible
 * would need a durable dispute log, not a payment status.
 *
 * Live and lost share one state on purpose too: both mean the money is not in the account, which
 * is the question this list answers. Which of the two it is changes what the operator DOES
 * (respond by the deadline, versus write it off), and that is a workflow this cut doesn't build.
 */
const hasDispute = (payments: readonly Payment[]): boolean =>
  payments.some((p) => p.status === "disputed" || p.status === "dispute_lost");

function stateOf(
  reservation: Reservation,
  balanceCents: number,
  paidCents: number,
  refundedCents: number,
  disputed: boolean,
): PaymentState {
  // Reservation status outranks money, and each status is named (§2.8.1 — no deny-list):
  // a cancelled booking is not a live order; a pending one is not an order yet.
  if (reservation.status === "cancelled") return "cancelled";
  if (reservation.status === "pending") return reservation.source === "admin" ? "awaiting" : "pending";
  // Above `refunded` and `unpaid` both. Without this a chargeback renders as "Unpaid" — true,
  // since `countsAsPaid` excludes it, but indistinguishable from a booking whose webhook never
  // landed, which is a different problem with a different fix. A dispute is the more specific
  // fact and the one that needs a person.
  if (disputed) return "disputed";
  if (refundedCents > 0) return "refunded";
  // A comp's frozen invoice charges nothing, so nothing was ever due: it is paid, not unpaid.
  if (paidCents <= 0) return reservation.invoice?.totalCents === 0 ? "paid" : "unpaid";
  return balanceCents > 0 ? "deposit" : "paid";
}

/** The bank's reason for a decline as the trail row and the admin text both say it: its code, or
 *  `declined` when it sent none. */
export function declineReasonOf(declineCode: string | undefined): string {
  return declineCode ?? "declined";
}

/** The latest failed balance attempt's outcome. A claim in flight (no outcome) and a success are
 *  skipped; the highest attempt number wins. */
function lastFailureOf(attempts: readonly BalanceChargeAttempt[]): "declined" | "needs_approval" | undefined {
  let latest: BalanceChargeAttempt | undefined;
  for (const a of attempts) {
    if (a.outcome !== "declined" && a.outcome !== "needs_approval") continue;
    if (!latest || a.attempt > latest.attempt) latest = a;
  }
  return latest?.outcome === "declined" || latest?.outcome === "needs_approval" ? latest.outcome : undefined;
}

/** Where a dated balance stands. Before the due instant it is `due`, whatever an attempt did; from
 *  it (`dueAt <= now`, the charge run's own test) it is exactly one of the other three. */
function statusOf(dueAt: string, now: string, attempts: readonly BalanceChargeAttempt[]): PurchaseOwedStatus {
  if (Date.parse(dueAt) > Date.parse(now)) return "due";
  return lastFailureOf(attempts) ?? "past_due";
}

/** What the booking still owes, or none (see `PurchaseRow.owed`). */
function owedOf(
  r: Reservation,
  state: PaymentState,
  balanceCents: number,
  attempts: readonly BalanceChargeAttempt[],
  now: string,
): PurchaseOwed | undefined {
  // Nothing paid: the whole frozen invoice is owed, tip, fee and insurance included. It is never a
  // balance due — no due date, no status — and a total of 0 is never owed.
  if (state === "unpaid" || state === "awaiting") {
    const total = r.invoice?.totalCents ?? 0;
    return total > 0 ? { cents: total } : undefined;
  }
  // `balanceCents` is already 0 off `booked`; a dispute is the Disputed entry's worklist.
  if (state === "disputed" || balanceCents <= 0) return undefined;
  const dueAt = r.balanceDueAt;
  return {
    cents: balanceCents,
    ...(dueAt ? { dueAt, status: statusOf(dueAt, now, attempts) } : {}),
  };
}

/**
 * Build one row per reservation. Muster's own sales and the operator's phone bookings (`admin`,
 * until paid — then they are `muster`); Xola owns its own money (DEC-105).
 */
export function buildPurchaseRows(input: PurchasesInput): PurchaseRow[] {
  const rows: PurchaseRow[] = [];
  for (const r of input.reservations) {
    if (r.source !== "muster" && r.source !== "admin") continue;

    const event = input.eventsById.get(String(r.eventId));
    const payments = input.paymentsByReservation.get(String(r.id)) ?? [];
    // `countsAsPaid` — a partially refunded row is still money the customer paid, shown gross
    // here with `refundedCents` on its own line (#522). The balance reads `tookMoney` instead.
    const succeeded = payments.filter(countsAsPaid);
    const paidCents = succeeded.reduce((sum, p) => sum + p.amountCents, 0);
    const refundedCents = payments.reduce((sum, p) => sum + (p.refundedCents ?? 0), 0);
    // A cancelled row owes nothing (issue #803). `stateOf` below already returns `cancelled`
    // from the reservation, so the label does not move — this only stops the page's due chip,
    // gated on `balanceCents > 0` alone, from reading "$538.18 due" on a cancelled booking.
    const balanceCents = balanceDueCents(r.status, r.invoice, payments);
    const state = stateOf(r, balanceCents, paidCents, refundedCents, hasDispute(payments));
    const vesselId = event?.vesselId ?? r.vesselId;
    const vessel = vesselId ? input.vesselById?.get(String(vesselId)) : undefined;
    const owed = owedOf(r, state, balanceCents, input.attemptsByReservation?.get(String(r.id)) ?? [], input.now);

    rows.push({
      reservationId: String(r.id),
      customerName: r.customerName,
      phone: r.phone,
      email: r.email,
      // A row with no Event yet names its slot itself (§2.8.2), so it reads as a trip rather than
      // a dash.
      date: event?.date ?? r.date,
      time: event?.time ?? r.time,
      offeringName: input.offeringNameByEventId?.get(String(r.eventId)),
      ...(vesselId ? { vesselId: String(vesselId) } : {}),
      vesselName: vessel?.name,
      ...(vessel?.hue !== undefined ? { vesselHue: vessel.hue } : {}),
      guestCount: r.partySize,
      paidCents,
      balanceCents,
      refundedCents,
      state,
      ...(owed ? { owed } : {}),
    });
  }
  // Unsorted: the page sorts (`sortPurchases`).
  return rows;
}

/** Does this row owe a dated balance — the Balance due entry's rule? An unpaid or awaiting row
 *  owes money but has no due date, so it is not a balance due. */
const hasBalanceDue = (r: PurchaseRow): boolean => r.owed?.dueAt !== undefined;

/** Filter by payment state. `"all"` passes everything; `balance_due` is a chip, not a state — it
 *  selects every row owing a dated balance whatever its state. */
export function filterByState(
  rows: readonly PurchaseRow[],
  state: StateFilter,
): PurchaseRow[] {
  if (state === "all") return [...rows];
  if (state === "balance_due") return rows.filter(hasBalanceDue);
  return rows.filter((r) => r.state === state);
}

/** A phone match needs at least this many digits. Without a floor, a query like "r2" or a
 *  name with a digit in it matches every phone containing that digit — the search silently
 *  returns unrelated people. Three is the shortest fragment an operator would actually type
 *  meaning "phone". */
const MIN_PHONE_QUERY_DIGITS = 3;

/**
 * Free-text search over name, phone, email and reservation id. Phone matching is digits-only on
 * both sides so "(216) 555" finds a stored "+12165550148" — the operator types what's in front
 * of them, not the canonical form (same rule as the customers list).
 */
export function searchPurchases(rows: readonly PurchaseRow[], query: string): PurchaseRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  const qDigits = q.replace(/\D/g, "");
  return rows.filter((r) => {
    if (r.customerName.toLowerCase().includes(q)) return true;
    if (r.email?.toLowerCase().includes(q)) return true;
    if (r.reservationId.toLowerCase().includes(q)) return true;
    return (
      qDigits.length >= MIN_PHONE_QUERY_DIGITS &&
      (r.phone ?? "").replace(/\D/g, "").includes(qDigits)
    );
  });
}

/** Counts per state for the filter chips — computed once, from the unfiltered set. */
export function stateCounts(
  rows: readonly PurchaseRow[],
): Record<StateFilter, number> {
  const counts: Record<StateFilter, number> = {
    all: rows.length,
    balance_due: 0,
    awaiting: 0,
    pending: 0,
    cancelled: 0,
    disputed: 0,
    refunded: 0,
    paid: 0,
    deposit: 0,
    unpaid: 0,
  };
  for (const r of rows) {
    counts[r.state]++;
    if (hasBalanceDue(r)) counts.balance_due++;
  }
  return counts;
}

/** Soonest trip first (date, then time), undated last. Stable, so ties keep the order they came in. */
export function sortPurchases(rows: readonly PurchaseRow[]): PurchaseRow[] {
  return [...rows].sort((a, b) => {
    if (a.date === undefined || b.date === undefined) {
      return (a.date === undefined ? 1 : 0) - (b.date === undefined ? 1 : 0);
    }
    return `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`);
  });
}

/** Rows whose trip date is inside `[from, to]`, both ends included; an undated row (a Xola-era
 *  row with no event and no slot) only under `all`. */
export function windowPurchases(
  rows: readonly PurchaseRow[],
  window: { from: string; to: string; kind: Scope },
): PurchaseRow[] {
  if (window.kind === "all") return [...rows];
  return rows.filter((r) => r.date !== undefined && r.date >= window.from && r.date <= window.to);
}

const UNDATED = "undated";

/**
 * One group per trip day, in the order the first row of each appears in the (sorted) input,
 * `undated` always last. `owedCents` is the sum of what is owed under the heading.
 */
export function groupPurchases(
  rows: readonly PurchaseRow[],
): { key: string; label: string; owedCents: number; rows: PurchaseRow[] }[] {
  const byKey = new Map<string, PurchaseRow[]>();
  for (const r of rows) {
    const key = r.date ?? UNDATED;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(r);
  }
  const groups = [...byKey.entries()].map(([key, members]) => ({
    key,
    label: key === UNDATED ? "No date" : fmtDayHeader(key),
    owedCents: members.reduce((sum, r) => sum + (r.owed?.cents ?? 0), 0),
    rows: members,
  }));
  return [...groups.filter((g) => g.key !== UNDATED), ...groups.filter((g) => g.key === UNDATED)];
}

/** The page's search params, as the carried-param functions read them. */
export type PurchasesSearch = {
  q?: string | undefined;
  state?: string | undefined;
  preset?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

/**
 * The carried params: `current` with `change` applied, defaults dropped (`state=all`, an empty `q`,
 * the bare default window — an explicit `preset=next7` stays). A `change` naming any of `preset`,
 * `from`, `to` replaces the whole window, never merges key by key, and drops the search unless the
 * change names `q` itself: a search covers every date, so a date pick that kept it would change
 * nothing on screen. Every chip href goes through this, and both forms' hidden fields are this minus
 * the keys the form submits.
 */
export function purchasesParams(
  current: PurchasesSearch,
  change: Partial<PurchasesSearch> = {},
): URLSearchParams {
  const windowChanged = "preset" in change || "from" in change || "to" in change;
  const window = windowChanged ? change : current;

  const p = windowParams(window, { allowPast: true, allowAll: true });
  // A window pick drops the search unless the same change names it.
  let q = current.q;
  if ("q" in change) q = change.q;
  else if (windowChanged) q = undefined;
  if (q) p.set("q", q);
  // Balance due ignores the window, so picking one from it goes back to All in that window: the pick
  // would otherwise change nothing on screen (operator, 2026-11-21). A change naming the state wins.
  let state = current.state;
  if ("state" in change) state = change.state;
  else if (windowChanged && current.state === "balance_due") state = "all";
  if (state && state !== "all") p.set("state", state);
  return p;
}

/** `/admin/purchases` plus `?` and the params when any. */
export function purchasesHref(current: PurchasesSearch, change?: Partial<PurchasesSearch>): string {
  const qs = purchasesParams(current, change).toString();
  return qs ? `/admin/purchases?${qs}` : "/admin/purchases";
}

/**
 * The list's composition. Each entry of the status dropdown counts the cards picking it would show
 * with the current dates and search (issue #1285 AC10): the window's bookings, or every booking
 * under a search; Balance due always every date. The cards shown are that set under the picked
 * status, searched, sorted and grouped by trip day.
 */
export function listPurchases(
  rows: readonly PurchaseRow[],
  opts: {
    q: string;
    state: StateFilter;
    window: { from: string; to: string; kind: Scope };
  },
): {
  counts: Record<StateFilter, number>;
  groups: ReturnType<typeof groupPurchases>;
  windowEmpty: boolean;
} {
  const everyDate = searchPurchases(rows, opts.q);
  const windowed = windowPurchases(rows, opts.window);
  // A search covers every date, so its window-bound entries count the same set it shows.
  const pool = ignoresWindow("all", opts.q) ? everyDate : windowed;
  const counts = { ...stateCounts(pool), balance_due: filterByState(everyDate, "balance_due").length };
  const shown = filterByState(ignoresWindow(opts.state, opts.q) ? everyDate : pool, opts.state);
  return {
    counts,
    groups: groupPurchases(sortPurchases(shown)),
    windowEmpty: !ignoresWindow(opts.state, opts.q) && windowed.length === 0 && rows.length > 0,
  };
}
