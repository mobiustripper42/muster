/**
 * Customers list + detail view models (12.12b, DEC-132) — pure, so the money math is testable
 * without a page.
 *
 * **Lifetime value is the number easiest to get quietly wrong**, so it is defined once, here:
 * the sum over a customer's **booked (non-cancelled)** reservations of `Event.price` plus the
 * frozen `Reservation.extrasCents`. It **excludes gratuity** — DEC-124 makes tips crew money,
 * never operator revenue, and the mockup says so in as many words ("never blended into revenue
 * totals"). It also excludes tax and any payment state: this is what the customer has *bought*,
 * not what has cleared. A cancelled booking contributes nothing.
 */

import { isBooked, type Customer, type Event, type Reservation } from "../domain/entities.js";

export interface CustomerBooking {
  reservationId: string;
  /** ISO `yyyy-mm-dd` of the departure, or `undefined` if the event row is missing. */
  date?: string | undefined;
  time?: string | undefined;
  guestCount: number;
  status: Reservation["status"];
  /** Base + frozen extras, in cents. Zero when the event carries no price. */
  valueCents: number;
}

export interface CustomerRow {
  id: string;
  displayCode: string;
  name: string;
  phoneE164: string;
  email?: string | undefined;
  active: boolean;
  /** Count of BOOKED reservations — cancelled ones don't count as bookings. */
  bookingCount: number;
  lifetimeCents: number;
}

export interface CustomerDetailView extends CustomerRow {
  createdAt: string;
  notes?: string | undefined;
  /** Newest departure first; cancelled bookings included but marked. */
  history: CustomerBooking[];
}

/** The value of ONE reservation: resolved base + frozen extras. Cancelled ⇒ 0. */
function bookingValueCents(r: Reservation, event: Event | undefined): number {
  if (!isBooked(r)) return 0;
  return (event?.price ?? 0) + (r.extrasCents ?? 0);
}

/**
 * What counts as a customer's history (14.3, SPEC §2.8.10): `booked`, and `cancelled` marked
 * as such. A `pending` row is a checkout in flight, not something they did — it has no event
 * (§2.8.2) and would render as an undated "Trip". Named statuses, not `!== "pending"` (§2.8.1).
 */
function isHistory(r: Reservation): boolean {
  return isBooked(r) || r.status === "cancelled";
}

/** Sort key for the history list — undated rows sink rather than throwing off the order. */
function departureKey(b: CustomerBooking): string {
  return `${b.date ?? ""} ${b.time ?? ""}`;
}

/** Build one customer's booking history + rollups. */
export function buildCustomerDetail(
  customer: Customer,
  reservations: readonly Reservation[],
  eventsById: ReadonlyMap<string, Event>,
): CustomerDetailView {
  const history: CustomerBooking[] = reservations
    .filter(isHistory)
    .map((r) => {
      const event = eventsById.get(String(r.eventId));
      return {
        reservationId: String(r.id),
        date: event?.date,
        time: event?.time,
        guestCount: r.partySize,
        status: r.status,
        valueCents: bookingValueCents(r, event),
      };
    })
    .sort((a, b) => departureKey(b).localeCompare(departureKey(a)));

  return {
    ...rowFor(customer, history),
    createdAt: customer.createdAt,
    ...(customer.notes !== undefined ? { notes: customer.notes } : {}),
    history,
  };
}

function rowFor(customer: Customer, history: readonly CustomerBooking[]): CustomerRow {
  const booked = history.filter((b) => b.status === "booked");
  return {
    id: String(customer.id),
    displayCode: customer.displayCode,
    name: customer.name,
    phoneE164: customer.phoneE164,
    ...(customer.email !== undefined ? { email: customer.email } : {}),
    active: customer.active,
    bookingCount: booked.length,
    lifetimeCents: booked.reduce((sum, b) => sum + b.valueCents, 0),
  };
}

/**
 * Build the list rows for every customer in one pass. Takes ALL reservations rather than
 * per-customer lists so the page does one read instead of N.
 */
export function buildCustomerRows(
  customers: readonly Customer[],
  reservations: readonly Reservation[],
  eventsById: ReadonlyMap<string, Event>,
): CustomerRow[] {
  const byCustomer = new Map<string, Reservation[]>();
  for (const r of reservations) {
    if (!r.customerId || !isHistory(r)) continue;
    const k = String(r.customerId);
    (byCustomer.get(k) ?? byCustomer.set(k, []).get(k)!).push(r);
  }

  return customers
    .map((c) =>
      rowFor(
        c,
        (byCustomer.get(String(c.id)) ?? []).map((r) => {
          const event = eventsById.get(String(r.eventId));
          return {
            reservationId: String(r.id),
            date: event?.date,
            time: event?.time,
            guestCount: r.partySize,
            status: r.status,
            valueCents: bookingValueCents(r, event),
          };
        }),
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A phone match needs at least this many digits. Without a floor, a query like "r2" or a
 *  name with a digit in it matches every phone containing that digit — the search silently
 *  returns unrelated people. Three is the shortest fragment an operator would actually type
 *  meaning "phone". */
const MIN_PHONE_QUERY_DIGITS = 3;

/**
 * Filter rows by an operator's free-text search: name, email, phone, or display code. Phone
 * matching is digits-only on both sides, so "(216) 555" finds "+12165550148" — the operator
 * types what's on their screen, not the canonical form.
 */
export function filterCustomerRows(rows: readonly CustomerRow[], query: string): CustomerRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  const qDigits = q.replace(/\D/g, "");
  return rows.filter((r) => {
    if (r.name.toLowerCase().includes(q)) return true;
    if (r.email?.toLowerCase().includes(q)) return true;
    if (r.displayCode.toLowerCase().includes(q)) return true;
    return (
      qDigits.length >= MIN_PHONE_QUERY_DIGITS &&
      r.phoneE164.replace(/\D/g, "").includes(qDigits)
    );
  });
}

/** Find a customer id by any of the searchable keys — used by the list's single-hit shortcut. */
export function soleMatch(rows: readonly CustomerRow[], query: string): CustomerRow | undefined {
  const hits = filterCustomerRows(rows, query);
  return hits.length === 1 ? hits[0] : undefined;
}
