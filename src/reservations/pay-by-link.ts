/**
 * The customer pays an operator's phone booking (issue #1082 part B, SPEC §2.10.6).
 *
 * The operator's `admin` row already holds the boat and carries the invoice frozen when they booked
 * (`operator-booking.ts`), so there is nothing to claim and nothing to price: each attempt at `/p`
 * puts a payable intent on that row through `attachPaymentIntent`, the checkout's own reuse rules,
 * and the ordinary confirm books it (§2.8.6) — turning it `muster` in the same write.
 *
 * **Only an unpaid operator's row is payable here.** A paid one is an ordinary `muster` booking; a
 * web checkout's pending row belongs to the browser that started it (its holder token), not to
 * whoever holds a link. Anything else is `missing`, the same answer as no row at all.
 */
import type { BookingInvoice, Reservation } from "../domain/entities.js";
import type { CheckoutQuote } from "./checkout-quote.js";
import type { ReservationId } from "../domain/ids.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { attachPaymentIntent } from "./create-departure-payment-intent.js";

/** What a payment link opens onto. The `/p` page renders one state per kind. */
export type PayLinkState =
  | { kind: "payable"; reservation: Reservation }
  | { kind: "paid"; reservation: Reservation }
  | { kind: "cancelled"; reservation: Reservation }
  | { kind: "missing" };

export function payLinkState(r: Reservation | null): PayLinkState {
  if (!r) return { kind: "missing" };
  if (r.status === "booked") return { kind: "paid", reservation: r };
  if (r.status === "cancelled") return { kind: "cancelled", reservation: r };
  if (r.source === "admin" && r.status === "pending") return { kind: "payable", reservation: r };
  return { kind: "missing" };
}

/**
 * The checkout's money shape, read off the invoice frozen when the operator booked — never
 * re-priced. What the customer is shown is what the row will be charged (`amountDueNowCents`), and
 * the tip is the tier the operator asked on the phone, fixed.
 *
 * The invoice keeps the extras' total but not how many guests the fare covers or the per-guest
 * price, so those come back as 0 and the summary labels the rows "Fare" and "Extra guests" rather
 * than inventing a count from live config (the same call as the operator's pane, issue #1104).
 */
export function payLinkMoney(inv: BookingInvoice): {
  money: Omit<CheckoutQuote, "tiers" | "defaultBps">;
  tip: { bps: number; tipCents: number };
} {
  const dueNowBeforeTipCents = inv.amountDueNowCents - inv.gratuityCents;
  const pretipTotal = inv.totalCents - inv.gratuityCents;
  const depositMode = dueNowBeforeTipCents < pretipTotal;
  return {
    money: {
      // Undiscounted, with the discount as its own row (DEC-194) — the summary subtracts it.
      fareCents: inv.fareCents + inv.extrasCents,
      discountCents: inv.discountCents ?? 0,
      baseCents: inv.fareCents,
      extraGuests: 0,
      extrasCents: inv.extrasCents,
      extraGuestPriceCents: 0,
      includedGuests: 0,
      taxCents: inv.taxCents,
      taxRateBps: inv.taxRateBps,
      serviceFeeCents: inv.serviceFeeCents,
      serviceFeeBps: inv.serviceFeeBps,
      dueNowBeforeTipCents,
      depositMode,
      balanceLaterCents: depositMode ? pretipTotal - dueNowBeforeTipCents : 0,
    },
    tip: { bps: inv.gratuityBps, tipCents: inv.gratuityCents },
  };
}

/** "+12165550199" → "(216) 555-…99": enough to recognise your own number, not enough to hand a
 *  stranger holding a forwarded link the whole thing. Read from the digits, because older and
 *  seeded rows store the number as it was typed; a non-US number keeps its last two digits. */
export function maskedPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return `…${digits.slice(-2)}`;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-…${national.slice(8)}`;
}

export type PayByLinkStart =
  | { ok: true; clientSecret: string; paymentIntentId: string }
  | {
      ok: false;
      /** `paid`: the row is booked. `already_paid`: its intent was paid moments ago and the
       *  confirm hasn't landed yet (15.8) — either way, never a second charge. */
      reason: "missing" | "paid" | "cancelled" | "already_paid";
    };

export async function startPayByLink(
  deps: { repo: Repository; payments: PaymentPort; now: () => string },
  reservationId: ReservationId,
): Promise<PayByLinkStart> {
  const state = payLinkState(await deps.repo.getReservation(reservationId));
  if (state.kind !== "payable") return { ok: false, reason: state.kind };
  const row = state.reservation;

  // The dashboard line, shaped like checkout's (#679). The offering may have been renamed or
  // retired since the booking; the charge still goes through, named for what is left.
  const offering = row.offeringId ? await deps.repo.getOffering(row.offeringId) : null;
  const guests = row.partySize ?? 0;
  const description = [
    `${offering?.name ?? "Charter"} — ${row.date ?? ""} ${row.time ?? ""}`.trim(),
    `${guests} guest${guests === 1 ? "" : "s"}`,
    row.customerName,
    "phone booking",
  ].join(" · ");

  return attachPaymentIntent(deps, row, {
    description,
    ...(row.email ? { receiptEmail: row.email } : {}),
  });
}
