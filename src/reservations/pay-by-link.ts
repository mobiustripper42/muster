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
import { balanceDueOn, type CheckoutQuote, type ScreenTotals } from "./checkout-quote.js";
import type { ReservationId } from "../domain/ids.js";
import type { PaymentPort } from "../ports/payment.js";
import type { Repository } from "../ports/repository.js";
import { balanceDates, insideBalanceWindow } from "./availability.js";
import { hasBalance } from "./booking-invoice.js";
import {
  attachPaymentIntent,
  priorIntentState,
  shownIsStale,
} from "./create-departure-payment-intent.js";
import { flexChargedCents } from "./discount.js";
import { depositOffered, dueNowCents, type PaymentConfig } from "./payment-config.js";

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
  // Owing nothing is not payable (DEC-194): a comp whose own confirm failed after the write sits
  // here pending with $0 due, and a $0 payment must never reach the provider.
  if (r.source === "admin" && r.status === "pending" && (r.invoice?.amountDueNowCents ?? 0) > 0) {
    return { kind: "payable", reservation: r };
  }
  return { kind: "missing" };
}

/**
 * The checkout's money shape, read off the invoice frozen when the operator booked — never
 * re-priced. The price is the operator's; the split (what is charged now, what is left, the balance
 * day) is the live settings' at `split.asOf`, worked out from `inv.totalCents` every time and never
 * from the `amountDueNowCents` the row happens to hold — a deposit attempt leaves that at the
 * deposit (issue #1251). The tip is the tier the operator asked on the phone, fixed.
 *
 * The invoice keeps the extras' total but not how many guests the fare covers or the per-guest
 * price, so those come back as 0 and the summary labels the rows "Fare" and "Extra guests" rather
 * than inventing a count from live config (the same call as the operator's pane, issue #1104).
 *
 * **`totals` are the invoice's own figures, never a recompute** (16.8). The tip and the insurance
 * are fixed here, so there is nothing to re-total — and an unpaid booking frozen under an older fee
 * rule (DEC-196 moved the tip into the fee's base) must show what it will actually be charged.
 */
export function payLinkMoney(
  inv: BookingInvoice,
  split: { config: PaymentConfig; date: string; time: string; asOf: string },
): {
  money: Omit<CheckoutQuote, "tiers" | "defaultBps">;
  tip: { bps: number; tipCents: number };
  totals: ScreenTotals;
} {
  const { config, date, time, asOf } = split;
  // The one place a deposit is offered or not, at the page and at the pay.
  const depositCents = depositOffered(inv.totalCents, config.depositCents, insideBalanceWindow(date, time, asOf, config))
    ? config.depositCents
    : null;
  // The tip- and insurance-free share of the whole quote, for the shape's sake — the screen reads `totals`.
  const dueNowBeforeTipCents = inv.totalCents - inv.gratuityCents - flexChargedCents(inv);
  // The deposit-preselected screen: what `splitFrozen` (components/checkout/money.ts) gives the
  // form's deposit choice. Core cannot import a component, so the same `dueNowCents` is called here.
  const dueNow = dueNowCents(inv.totalCents, depositCents);
  return {
    totals: {
      tipCents: inv.gratuityCents,
      flexCents: inv.flexCents ?? 0,
      taxCents: inv.taxCents,
      serviceFeeCents: inv.serviceFeeCents,
      totalCents: inv.totalCents,
      dueNowCents: dueNow,
      balanceCents: inv.totalCents - dueNow,
    },
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
      depositCents,
      balanceDueOn: depositCents === null ? null : balanceDueOn(date, time, config),
      flexCents: inv.flexCents ?? 0,
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
    }
  | {
      ok: false;
      /** The split the page showed is not the split this payment would make (issue #1251): the
       *  trip crossed into the balance window, or the deposit setting moved. Nothing was written. */
      reason: "stale";
    };

/**
 * Pay the phone booking by link. The customer's choice and the figures their page showed arrive as
 * `choice`; the split is decided here from the live settings and the clock (issue #1251), written
 * into the row's due-now field and dates, and the price on the invoice is left as the operator
 * froze it. A payment whose split is not the one shown is refused before anything is written.
 */
export async function startPayByLink(
  deps: { repo: Repository; payments: PaymentPort; now: () => string },
  reservationId: ReservationId,
  choice: { payDeposit: boolean; shownDueNowCents?: number; shownBalanceCents?: number },
): Promise<PayByLinkStart> {
  const state = payLinkState(await deps.repo.getReservation(reservationId));
  if (state.kind !== "payable") return { ok: false, reason: state.kind };
  const stored = state.reservation;
  const frozen = stored.invoice!; // payable means an operator's row with an invoice

  // The split, from the live settings and the clock — the page's own function, so the two cannot
  // disagree about whether a deposit is offered. An operator's row names its slot.
  const config = await deps.repo.getPaymentConfig();
  const date = stored.date!;
  const time = stored.time!;
  const { money } = payLinkMoney(frozen, { config, date, time, asOf: deps.now() });
  const invoice: BookingInvoice = {
    ...frozen,
    amountDueNowCents: dueNowCents(frozen.totalCents, choice.payDeposit ? money.depositCents : null),
  };

  // Already paid before stale, as the checkout does: a customer whose other tab paid is never told
  // "you have not been charged".
  if (shownIsStale(invoice, choice.shownDueNowCents, choice.shownBalanceCents)) {
    return (await priorIntentState(deps.payments, stored)) === "settled"
      ? { ok: false, reason: "already_paid" }
      : { ok: false, reason: "stale" };
  }

  // The attempt's row: this split, and its dates only when it leaves a balance — never the stored
  // row's carried forward, so Pay in full after a deposit attempt clears them.
  const { balanceDueAt: _dueAt, balanceReleaseAt: _releaseAt, ...bare } = stored;
  const dates = hasBalance(invoice) ? balanceDates(date, time, config) : null;
  const row: Reservation = {
    ...bare,
    invoice,
    ...(dates ? { balanceDueAt: dates.dueAt, balanceReleaseAt: dates.releaseAt } : {}),
  };

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

  return attachPaymentIntent(
    deps,
    row,
    {
      description,
      ...(row.email ? { receiptEmail: row.email } : {}),
    },
    undefined,
    // What the last intent was minted for: the stored split, before this attempt rewrites it.
    { priorHadBalance: hasBalance(frozen) },
  );
}
