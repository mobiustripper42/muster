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

import type { Event, Payment, Reservation } from "../domain/entities.js";
import { balanceOwedCents, countsAsPaid, taxCentsFor } from "./payment-config.js";

/**
 * The mockup shows three states (Paid / Deposit / Refunded). Real data needs two more:
 *
 * - `unpaid` — a booked reservation with NO succeeded payment. The mockup never drew it, but
 *   it exists (Xola-era rows, seeded demo data, a booking whose webhook hasn't landed). Folding
 *   it into `deposit` would tell the operator money arrived when none did — the one error this
 *   list must not make.
 * - `cancelled` — the reservation's own status, which outranks any payment state for display.
 *   A cancelled booking showing "Paid" reads like a live order.
 */
export type PaymentState = "cancelled" | "disputed" | "refunded" | "paid" | "deposit" | "unpaid";

export interface PurchaseRow {
  reservationId: string;
  customerName: string;
  /** Contact for the list's second column — phone preferred, email as fallback. */
  phone?: string | undefined;
  email?: string | undefined;
  /** Departure date/time, or undefined when the event row is missing. */
  date?: string | undefined;
  time?: string | undefined;
  offeringName?: string | undefined;
  vesselName?: string | undefined;
  guestCount: number;
  /** Fare + tax — the order total. Gratuity is NOT included (DEC-124: crew money). */
  totalCents: number;
  /** Σ succeeded payments, gross of any bundled tip — what the card actually took. */
  paidCents: number;
  balanceCents: number;
  refundedCents: number;
  state: PaymentState;
  /** `false` ⇒ the event carries no price, so the money columns can't be trusted. */
  priceKnown: boolean;
}

export interface PurchasesInput {
  reservations: readonly Reservation[];
  eventsById: ReadonlyMap<string, Event>;
  paymentsByReservation: ReadonlyMap<string, Payment[]>;
  offeringNameByEventId?: ReadonlyMap<string, string> | undefined;
  vesselNameById?: ReadonlyMap<string, string> | undefined;
  taxRateBps: number;
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
  // Reservation status outranks money: a cancelled booking is not a live order.
  if (reservation.status !== "booked") return "cancelled";
  // Above `refunded` and `unpaid` both. Without this a chargeback renders as "Unpaid" — true,
  // since `countsAsPaid` excludes it, but indistinguishable from a booking whose webhook never
  // landed, which is a different problem with a different fix. A dispute is the more specific
  // fact and the one that needs a person.
  if (disputed) return "disputed";
  if (refundedCents > 0) return "refunded";
  if (paidCents <= 0) return "unpaid";
  return balanceCents > 0 ? "deposit" : "paid";
}

/** Build one row per reservation. Muster-side only — Xola owns its own money (DEC-105). */
export function buildPurchaseRows(input: PurchasesInput): PurchaseRow[] {
  const rows: PurchaseRow[] = [];
  for (const r of input.reservations) {
    if (r.source !== "muster") continue;

    const event = input.eventsById.get(String(r.eventId));
    const priceKnown = typeof event?.price === "number";
    const fareCents = (event?.price ?? 0) + (r.extrasCents ?? 0);
    const totalCents = fareCents + taxCentsFor(fareCents, input.taxRateBps);
    const payments = input.paymentsByReservation.get(String(r.id)) ?? [];
    // `countsAsPaid`, shared with `balanceOwedCents` — a partially refunded row is still
    // money the customer paid, shown gross here with `refundedCents` on its own line (#522).
    const succeeded = payments.filter(countsAsPaid);
    const paidCents = succeeded.reduce((sum, p) => sum + p.amountCents, 0);
    const refundedCents = payments.reduce((sum, p) => sum + (p.refundedCents ?? 0), 0);
    const balanceCents = balanceOwedCents(fareCents, input.taxRateBps, payments);

    rows.push({
      reservationId: String(r.id),
      customerName: r.customerName,
      phone: r.phone,
      email: r.email,
      date: event?.date,
      time: event?.time,
      offeringName: input.offeringNameByEventId?.get(String(r.eventId)),
      vesselName: event ? input.vesselNameById?.get(String(event.vesselId)) : undefined,
      guestCount: r.partySize,
      totalCents,
      paidCents,
      balanceCents,
      refundedCents,
      state: stateOf(r, balanceCents, paidCents, refundedCents, hasDispute(payments)),
      priceKnown,
    });
  }

  // Newest departure first — an operator looking for "the booking someone just called about"
  // is far more often looking at an upcoming or recent trip than at the oldest one.
  return rows.sort((a, b) =>
    `${b.date ?? ""} ${b.time ?? ""}`.localeCompare(`${a.date ?? ""} ${a.time ?? ""}`),
  );
}

/** Filter by payment state. `"all"` passes everything. */
export function filterByState(
  rows: readonly PurchaseRow[],
  state: PaymentState | "all",
): PurchaseRow[] {
  return state === "all" ? [...rows] : rows.filter((r) => r.state === state);
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
export function stateCounts(rows: readonly PurchaseRow[]): Record<PaymentState | "all", number> {
  const counts: Record<PaymentState | "all", number> = {
    all: rows.length,
    cancelled: 0,
    disputed: 0,
    refunded: 0,
    paid: 0,
    deposit: 0,
    unpaid: 0,
  };
  for (const r of rows) counts[r.state]++;
  return counts;
}
