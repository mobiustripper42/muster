"use client";

import type { ReactNode } from "react";
import { money, type ScreenTotals } from "./money";

/**
 * The sticky bar at the foot of a checkout (16.1d, issue #1092) — what is due now, the total
 * under it when a deposit leaves a balance, and the caller's submit control. Pinned inside the card's scroll
 * region (book-controls idiom).
 *
 * The button is a slot because the two surfaces submit differently: the customer's is a client
 * `onSubmit` into Stripe, the operator's a server-action post. The bar owns the figures only.
 */
export function PayBar({
  t,
  children,
}: {
  /** The same figures the summary shows (`totalsFor`, or a frozen invoice). */
  t: ScreenTotals;
  children: ReactNode;
}) {
  const { dueNowCents, totalCents } = t;
  // Whether a deposit is being paid is the totals' answer, not the quote's: the customer may choose
  // to pay in full (issue #1250).
  const deposit = t.balanceCents > 0;
  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-3.5 border-t border-line bg-card px-4 py-3">
      <div className="flex flex-col">
        <span className="text-[10.5px] text-muted">{deposit ? "Due now" : "Total"}</span>
        <b className="text-[18px] font-bold tabular-nums" data-testid="due-now">
          {money(dueNowCents)}
        </b>
        {deposit && <span className="text-[10.5px] text-muted">{money(totalCents)} total</span>}
      </div>
      {children}
    </div>
  );
}
