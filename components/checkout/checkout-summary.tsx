"use client";

import { money, type CheckoutMoney, type ScreenTotals } from "./money";

/**
 * The money block (16.1d, issue #1092) — fare, extras, tip, tax, fee, total, and in deposit mode
 * what is due now and what is left. Shared by the customer's checkout and the operator's phone
 * booking, so the figure the operator reads out on the phone is the one this block shows a
 * customer for the same trip, party and tip.
 *
 * `frozen` is the payment link's (issue #1082 part B): its figures come off an invoice frozen at
 * booking, which keeps the extras' total but not the guest count the fare covers or the per-guest
 * price — so the rows read "Fare" and "Extra guests" rather than a count read off live config.
 *
 * `t` carries the figures that move with the tip and the insurance (16.8) — tax, fee, the
 * insurance row and both totals — computed by the caller (`totalsFor`, or a frozen invoice). The
 * insurance row shows only when bought, at its price; any discount that reached it is already in
 * the Discount row above.
 */
export function CheckoutSummary({
  m,
  tipBps,
  t,
  frozen = false,
}: {
  m: CheckoutMoney;
  tipBps: number;
  t: ScreenTotals;
  frozen?: boolean;
}) {
  const { tipCents, flexCents, dueNowCents, totalCents } = t;
  return (
    <div className="pt-5">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">Summary</div>
      <div className="border-t border-line pt-2 text-[13.5px]">
        <SummaryRow label={frozen ? "Fare" : `Fare — up to ${m.includedGuests} guests`} value={money(m.baseCents)} />
        {frozen && m.extrasCents > 0 && <SummaryRow label="Extra guests" value={money(m.extrasCents)} />}
        {!frozen && m.extraGuests > 0 && (
          <SummaryRow
            label={`${m.extraGuests} extra ${m.extraGuests === 1 ? "guest" : "guests"} · ${money(m.extraGuestPriceCents)}`}
            value={money(m.extrasCents)}
          />
        )}
        {/* The operator's dollars off (DEC-194) — on the phone booking's form and the payment link,
            never on the public checkout, where it is always 0. */}
        {m.discountCents > 0 && (
          <SummaryRow label="Discount" value={`−${money(m.discountCents)}`} testId="summary-discount" />
        )}
        <SummaryRow
          label={`Tip your crew · ${tipBps / 100}% → crew`}
          value={money(tipCents)}
          tone="crew"
          testId="summary-tip"
        />
        <SummaryRow
          label={`Tax · ${(m.taxRateBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}
          value={money(t.taxCents)}
        />
        <SummaryRow
          label={`Service fee · ${(m.serviceFeeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}
          value={money(t.serviceFeeCents)}
          testId="summary-fee"
        />
        {flexCents > 0 && (
          <SummaryRow label="Cancellation insurance" value={money(flexCents)} testId="summary-insurance" />
        )}
        <div
          className="mt-1 flex justify-between border-t border-line pt-2 text-[15px] font-bold"
          data-testid="summary-total"
        >
          <span>Total</span>
          <span className="font-mono">{money(totalCents)}</span>
        </div>
        {m.depositMode && (
          <>
            <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold" data-testid="summary-due-now">
              <span>Due now</span>
              <span className="font-mono">{money(dueNowCents)}</span>
            </div>
            <div className="flex justify-between py-1 text-muted">
              {/* Not "charged" — nothing collects this automatically (#617; #712 is the
                  unbuilt auto-collect). Promising it at the point of sale is the worst
                  place to promise it. */}
              <span>Balance · due before your trip</span>
              <span className="font-mono">{money(m.balanceLaterCents)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: "crew";
  testId?: string;
}) {
  return (
    <div
      className={`flex justify-between py-1 ${tone === "crew" ? "text-mate" : ""}`}
      {...(testId ? { "data-testid": testId } : {})}
    >
      <span className={tone === "crew" ? "" : "text-muted"}>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
