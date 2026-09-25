"use client";

import { money, totalsWithTip, type CheckoutMoney } from "./money";

/**
 * The money block (16.1d, issue #1092) — fare, extras, tip, tax, fee, total, and in deposit mode
 * what is due now and what is left. Shared by the customer's checkout and the operator's phone
 * booking, so the figure the operator reads out on the phone is the one this block shows a
 * customer for the same trip, party and tip.
 */
export function CheckoutSummary({
  m,
  tipBps,
  tipCents,
}: {
  m: CheckoutMoney;
  tipBps: number;
  tipCents: number;
}) {
  const { dueNowCents, totalCents } = totalsWithTip(m, tipCents);
  return (
    <div className="pt-5">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">Summary</div>
      <div className="border-t border-line pt-2 text-[13.5px]">
        <SummaryRow label={`Fare — up to ${m.includedGuests} guests`} value={money(m.baseCents)} />
        {m.extraGuests > 0 && (
          <SummaryRow
            label={`${m.extraGuests} extra ${m.extraGuests === 1 ? "guest" : "guests"} · ${money(m.extraGuestPriceCents)}`}
            value={money(m.extrasCents)}
          />
        )}
        <SummaryRow
          label={`Tip your crew · ${tipBps / 100}% → crew`}
          value={money(tipCents)}
          tone="crew"
          testId="summary-tip"
        />
        <SummaryRow
          label={`Tax · ${(m.taxRateBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}
          value={money(m.taxCents)}
        />
        <SummaryRow
          label={`Service fee · ${(m.serviceFeeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}
          value={money(m.serviceFeeCents)}
          testId="summary-fee"
        />
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
