import { formatCents, type ReservationDetailView } from "@core/reservations/calendar-detail.js";
import { offeringDotClass } from "@core/reservations/calendar-grid.js";
import { AppLink } from "../../../../../components/ui/app-link";
import { vesselHueClass } from "../../../../lib/vessel-hue";
import { clockTime, formatShortDay } from "../calendar-view";
import { CopyButton } from "../../../../../components/ui/copy-button";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { createBalanceLink } from "./actions";

/** Operator-facing copy for a refused balance link. Says what happened, not a reason code. */
function balanceErrorMessage(reason: string): string {
  switch (reason) {
    case "no_balance":
      return "Nothing is owed on this booking — the balance is already settled.";
    case "not_active":
      return "This booking is cancelled, so there’s no balance to collect.";
    case "unpriced":
      return "This departure has no recorded price, so a balance can’t be computed.";
    case "reservation_missing":
      return "Balances are Muster-side only — this reservation is owned by Xola.";
    case "stripe_not_configured":
      return "Stripe isn’t configured on this deployment, so no link can be minted.";
    case "stripe_unreachable":
      return "Couldn’t reach Stripe just now. Try again in a moment.";
    default:
      return "Couldn’t create a balance link.";
  }
}

/**
 * The reservation detail pane (task 12.11 continued, #464) — read-only, per the approved
 * scope: NO actions in this slice (message / guests / change time / resend / refund / cancel
 * all defer, and refund waits on #472 besides). The pane is the same component in both form
 * factors; the route decides whether it sits beside the grid or replaces it.
 *
 * Three sections the mockup drew are deliberately shaped differently — see the module note in
 * `src/reservations/calendar-detail.ts`: add-ons are omitted (no per-reservation selection
 * exists), the waiver is one consent row rather than a per-attendee tally, and the date row is
 * "Updated" rather than "Booked". The mockup's 3% service fee isn't modelled at all.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <span className="text-right text-sm text-ink">{children}</span>
    </div>
  );
}

function Section({ title, tag }: { title: string; tag?: string }) {
  return (
    <div className="mt-4 mb-1 flex items-center gap-2 border-b border-line pb-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{title}</span>
      {tag && (
        <span className="rounded border border-line px-1.5 py-px text-[10px] text-muted">{tag}</span>
      )}
    </div>
  );
}

function waiverText(w: ReservationDetailView["waiver"]): string {
  if (w.kind === "consented") {
    const day = w.at.slice(0, 10);
    return w.version ? `Signed ${day} · ${w.version}` : `Signed ${day}`;
  }
  return w.kind === "xola" ? "Held in Xola" : "Not on file";
}

export function ReservationDetailPane({
  v,
  balance,
}: {
  v: ReservationDetailView;
  /** Balance-link state from the query string (11.2b) — the minted URL, or why not. */
  balance?: { url?: string | undefined; err?: string | undefined; date: string; filter: string } | undefined;
}) {
  const money = v.money;

  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
      {/* No name heading here — the page's own <h1> already names the reservation, directly
          above this pane in both layouts. Repeating it read as a stutter on mobile. */}
      <div className="border-b border-line px-4 py-3">
        {v.status === "cancelled" && (
          <span className="mb-1.5 inline-block rounded border border-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">
            Cancelled
          </span>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>
            {formatShortDay(v.date)} · {clockTime(v.time)}
          </span>
          {v.vesselName && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${vesselHueClass(v.vesselId ?? "", v.vesselHue)}`}
                aria-hidden
              />
              {v.vesselName}
            </span>
          )}
          {v.offeringName && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-sm ${offeringDotClass(v.offeringId ?? "")}`}
                aria-hidden
              />
              {v.offeringName}
            </span>
          )}
          {/* Crew is the shift view's job — cross-link, never re-managed here (DEC-123). */}
          {v.crew && (
            <AppLink
              href={`/admin/shift/${v.crew.shiftId}`}
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              Crewed{" "}
              <b className="font-semibold text-ink">
                {v.crew.filled}/{v.crew.required}
              </b>{" "}
              ↗
            </AppLink>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        <Section title="Contact" />
        <Row label="Phone">
          {v.phone ? <span className="font-mono text-[13px]">{v.phone}</span> : <Faint>—</Faint>}
        </Row>
        <Row label="Email">
          {v.email ? (
            <span className="break-all font-mono text-[12px]">{v.email}</span>
          ) : (
            <Faint>—</Faint>
          )}
        </Row>
        {/* `updatedAt` is the last MATERIAL change (DEC-029), not a booking date — labelled so. */}
        <Row label="Updated">
          {v.updatedAt ? v.updatedAt.slice(0, 10) : <Faint>Not tracked</Faint>}
        </Row>
        <Row label="Source">{v.source === "xola" ? "Xola" : "Muster"}</Row>

        <Section title="Trip" />
        <Row label="Guests">
          {v.guestCount} <span className="font-normal text-faint">of {v.capacity}</span>
        </Row>
        {/* One consent record per reservation, not a per-attendee roster (DEC-012 / DEC-110). */}
        <Row label="Waiver">{waiverText(v.waiver)}</Row>

        {v.gratuityRows.length > 0 && (
          <>
            <Section title="Gratuity" tag="crew · tax-exempt" />
            {v.gratuityRows.map((g, i) => (
              <Row
                key={`${g.kind}-${i}`}
                label={g.kind === "pre" ? "At checkout" : "After the trip"}
              >
                <span className="font-mono">{formatCents(g.amountCents)}</span>
                {g.bps !== undefined && (
                  <span className="ml-1.5 text-xs text-faint">{g.bps / 100}%</span>
                )}
              </Row>
            ))}
          </>
        )}

        <Section title="Money" />
        {money.priceKnown ? (
          <div className="rounded-lg border border-line px-3 py-2">
            <Row label="Fare">
              <span className="font-mono">{formatCents(money.fareCents)}</span>
            </Row>
            <Row label="Tax">
              <span className="font-mono">{formatCents(money.taxCents)}</span>
            </Row>
            {money.gratuityCents > 0 && (
              <Row label="Tip">
                <span className="font-mono">{formatCents(money.gratuityCents)}</span>
              </Row>
            )}
            <div className="mt-1 border-t border-line pt-1">
              <Row label="Paid">
                <span className="font-mono font-semibold">{formatCents(money.paidCents)}</span>
              </Row>
              {money.refundedCents > 0 && (
                <Row label="Refunded">
                  <span className="font-mono">{formatCents(money.refundedCents)}</span>
                </Row>
              )}
              <Row label={money.balanceCents > 0 ? "Balance due" : "Balance"}>
                <span
                  className={`font-mono ${money.balanceCents > 0 ? "font-semibold text-ink" : "text-muted"}`}
                >
                  {money.balanceCents > 0 ? formatCents(money.balanceCents) : "Settled"}
                </span>
              </Row>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">
            This departure has no recorded price, so the fare and balance can’t be derived.
          </p>
        )}

        {/* The ONE action in this pane (11.2b, DEC-107). Shown only when money is actually
            owed — a "collect balance" button on a settled booking is a trap. The operator
            sends the link; the customer pays; the webhook writes the payment. Nothing is
            charged or written here, so re-minting is free and needs no confirmation. */}
        {money.priceKnown && money.balanceCents > 0 && balance && (
          <div className="mt-3 border-t border-line pt-3">
            {balance.url ? (
              <>
                <p className="mb-1.5 text-xs text-muted">
                  Balance link for {formatCents(money.balanceCents)} — send it to the customer.
                  It expires with the Stripe session; mint a fresh one any time.
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className="min-w-0 flex-1 select-all truncate rounded-lg border border-line bg-bg px-2 py-1.5 font-mono text-[11px] text-muted"
                    data-testid="balance-link"
                  >
                    {balance.url}
                  </span>
                  <CopyButton value={balance.url} label="Copy link" />
                </div>
              </>
            ) : (
              <form action={createBalanceLink}>
                <input type="hidden" name="reservationId" value={v.reservationId} />
                <input type="hidden" name="date" value={balance.date} />
                <input type="hidden" name="filter" value={balance.filter} />
                <SubmitButton className="min-h-[44px] w-full rounded-lg border border-line bg-ink px-3 text-sm font-medium text-white">
                  Create balance link
                </SubmitButton>
                {balance.err && (
                  <p className="mt-1.5 text-xs text-bad">{balanceErrorMessage(balance.err)}</p>
                )}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Faint({ children }: { children: React.ReactNode }) {
  return <span className="text-faint">{children}</span>;
}
