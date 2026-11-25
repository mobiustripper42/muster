import type { PaymentState, PurchaseOwed, PurchaseRow } from "@core/reservations/purchases-view.js";
import { formatCents } from "@core/reservations/calendar-detail.js";
import { dueDayLabel } from "@core/reservations/checkout-quote.js";
import { AppLink } from "../ui/app-link";
import { Badge, type Tone } from "../ui/badge";
import { Card } from "../ui/card";
import { fmt12, guestCount } from "../../app/lib/format";
import { VesselLabel } from "./vessel-label";

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
 * The words under the amount, one per way an owed amount can stand (issue #1285). Keyed by the
 * row's `owed.status` plus `undated` for an amount with no due date, and typed so a missing key
 * fails to compile. The three past-due words are in the `bad` tone: the operator's morning read.
 */
const UNDER_AMOUNT: Record<NonNullable<PurchaseOwed["status"]> | "undated", { words: (dueAt: string) => string; bad: boolean }> = {
  due: { words: (dueAt) => `due ${dueDayLabel(dueAt)}`, bad: false },
  past_due: { words: () => "Past due", bad: true },
  needs_approval: { words: () => "Needs approval", bad: true },
  declined: { words: () => "Card declined", bad: true },
  undated: { words: () => "owed", bad: false },
};

/**
 * One booking on `/admin/purchases` — a card like All Shifts' row (issue #1285), the same at every
 * width. The name, the vessel and what is still owed lead; the time and guests sit under the name,
 * the due date or what became of the charge under the amount, and the status badge last. The only
 * amount on it is what is owed, and a card that owes nothing carries none. The whole card is the
 * link to the booking's calendar pane (`href`), so there is no second way in.
 *
 * A long name wraps in its own column, so the amount never moves; the amount, the vessel and the
 * badge never wrap.
 */
export function PurchaseCard({ row, href }: { row: PurchaseRow; href: string }) {
  const owed = row.owed;
  const under = owed ? UNDER_AMOUNT[owed.status ?? "undated"] : undefined;
  return (
    <Card className="stretch-card flex flex-col gap-2">
      {/* Three columns, the last a fixed width and held open on a card that owes nothing, so the vessel
          and the amount stand in the same place on every card in the list. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_6rem] items-baseline gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]">
        {/* The stretched link (`stretch-link`): its overlay fills the card, so the whole card opens
            the booking. `spinner="overlay"` covers the card from the click until the pane renders. */}
        <AppLink href={href} spinner="overlay" className="stretch-link min-w-0 break-words font-semibold text-ink">
          {row.customerName}
        </AppLink>
        {row.vesselId && row.vesselName && (
          <span className="col-start-2 whitespace-nowrap text-sm">
            <VesselLabel id={row.vesselId} hue={row.vesselHue} name={row.vesselName} />
          </span>
        )}
        {owed && under && (
          <div
            data-testid={`owed-${row.reservationId}`}
            className="col-start-3 row-span-2 row-start-1 whitespace-nowrap text-right"
          >
            <div className="font-mono font-semibold text-ink">{formatCents(owed.cents)}</div>
            <div className={`text-xs ${under.bad ? "text-bad" : "text-muted"}`}>
              {under.words(owed.dueAt ?? "")}
            </div>
          </div>
        )}
        <span className="col-span-2 col-start-1 row-start-2 font-mono text-xs text-muted">
          {row.time ? `${fmt12(row.time)} · ` : ""}
          {guestCount(row.guestCount)}
        </span>
      </div>
      <div>
        <Badge
          data-testid={`row-state-${row.reservationId}`}
          tone={BADGE[row.state]}
          className="whitespace-nowrap"
        >
          {BADGE_TEXT[row.state] ?? row.state}
        </Badge>
      </div>
    </Card>
  );
}
