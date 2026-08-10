import { formatCents, type ReservationDetailView } from "@core/reservations/calendar-detail.js";
import { offeringDotClass } from "@core/reservations/calendar-grid.js";
import { AppLink } from "../../../../../components/ui/app-link";
import { vesselHueClass } from "../../../../lib/vessel-hue";
import { clockTime, formatShortDay } from "../calendar-view";
import { CopyButton } from "../../../../../components/ui/copy-button";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { RefundAmountSync } from "../../../../../components/admin/refund-amount-sync";
import {
  cancelBooking,
  createBalanceLink,
  refundBooking,
  resendConfirmation,
  startRefund,
} from "./actions";

/**
 * Everything the actions block needs, resolved by the route (#616). Passed in rather than
 * derived in `buildReservationDetail` because two of these need a CLOCK — the refund quotes
 * depend on how much notice the cancellation gives — and the detail view model is pure.
 */
export interface PaneActionState {
  date: string;
  filter: string;
  /** This reservation's detail with the confirm block open. */
  cancelHref: string;
  /** …and with it closed — the "Do Not Cancel" escape. */
  backHref: string;
  confirmingCancel: boolean;
  /** Published-terms refund if the CUSTOMER asked, in cents. */
  quoteCustomerCents: number;
  /** …and if WE cancelled (weather, crew, mechanical) — everything paid, no fee. */
  quoteOperatorCents: number;
  /** Stripe's real ceiling: what the charges can still give back. */
  refundableCents: number;
  /** Already refunded — the compare-and-swap token the form posts back. */
  refundedTotalCents: number;
  /** Dollars string prefilled into the amount box. */
  refundPrefill: string;
  /** Cents awaiting confirmation, from `?refundConfirm=` — the two-step's second screen. */
  confirmingRefundCents?: number | undefined;
  /** …and the href that backs out of it. */
  refundBackHref: string;
  canResend: boolean;
  /**
   * The reservation is cancelled but its event is still `scheduled` — a half-applied cancel.
   * The boat is silently still held: neighbouring departures stay unsellable and the crew shift
   * never collapsed. `cancelReservation` repairs this on a re-run, so the pane has to offer one.
   */
  needsRelease: boolean;
  /** Outcome copy from the last action, if any. */
  done?: string | undefined;
  error?: string | undefined;
}

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
 * Operator-facing copy for a refused or completed action (#616). Says what happened.
 *
 * `movedCents` is only meaningful for a PARTIAL refund failure, where some legs landed and
 * some did not. That case redirects with both an error and an amount, and the operator's next
 * decision depends entirely on the amount — "Stripe failed, try again" against a refund that
 * already moved $200 is how a customer gets refunded twice.
 *
 * `refundableCents` decides whether the post-cancel copy may promise a refund step at all. On a
 * booking nobody paid for there is no refund box, and telling the operator an amount has been
 * filled in for them is a straightforward lie about the screen they are looking at.
 *
 * **No copy here says "above" or "below".** It did, and the #718 reorder — which moved the
 * refund box to sit before the cancel block so a vanishing button stops landing under a thumb —
 * turned every one of those words into a wrong direction. Position is the one property of a
 * layout that a later, unrelated fix is most likely to change.
 */
export function actionMessage(
  kind: string,
  value: string,
  opts: { movedCents?: number; refundableCents?: number } = {},
): string {
  const { movedCents, refundableCents = 0 } = opts;
  switch (kind) {
    case "cancelled": {
      // `cancelled` now arrives WITH the refund outcome, because one press does both. The copy
      // has to report the compound result: saying "the refund box is filled in" after the money
      // has already gone is the same class of lie as the positional copy this file removed
      // earlier — technically about the right feature, false about the screen in front of you.
      const freed = "Cancelled. The boat is free again and the crew have been told.";
      if (movedCents !== undefined && movedCents > 0) {
        return `${freed} ${formatCents(movedCents)} refunded to the card it came from.`;
      }
      if (refundableCents <= 0) {
        return `${freed} Nothing was paid on this booking, so there was nothing to refund.`;
      }
      return `${freed} No refund was sent — use the refund box if something is owed.`;
    }
    case "refunded":
      return `Refunded ${formatCents(Number(value) || 0)} to the card it came from.`;
    case "resent":
      return "Confirmation and manage link sent again.";
    case "cancelErr":
      return value === "not_muster"
        ? "This booking is Xola's — cancel it there, or the next import will bring it back."
        : value === "reservation_missing"
          ? "That reservation no longer exists."
          : "Couldn’t cancel just now. Try again in a moment.";
    case "refundErr":
      switch (value) {
        case "invalid_amount":
          return "Enter an amount like 50 or 536.25.";
        case "exceeds_refundable":
          return "That’s more than this booking can give back. Check the figure above.";
        case "no_payment_intent":
          return "One of the charges has no Stripe payment on file, so it can’t be refunded from here. Refund that one in the Stripe dashboard.";
        case "stale":
          return "Nothing was refunded — this page was out of date (a refund had already gone through). It’s reloaded now; check the figures before trying again.";
        case "provider_error":
          return movedCents && movedCents > 0
            ? `Stripe failed partway. ${formatCents(movedCents)} DID go back to the customer; the rest did not. Check Stripe before retrying — retrying the full amount would refund that ${formatCents(movedCents)} twice.`
            : "Stripe failed and NOTHING was refunded. Check Stripe before retrying.";
        case "not_muster":
          return "This booking is Xola's — its money lives in Xola.";
        case "stripe_not_configured":
          return "Stripe isn’t configured on this deployment, so nothing can be refunded from here.";
        default:
          return "Couldn’t refund just now. Nothing moved. Try again in a moment.";
      }
    case "resendErr":
      return value === "cancelled"
        ? "This booking is cancelled — resending would confirm a trip that isn’t sailing."
        : value === "no_contact"
        ? "This booking has no email or phone on it, so there’s nowhere to send."
        : value === "not_muster"
          ? "Xola bookings have no Muster manage link."
          : "Couldn’t send just now. Try again in a moment.";
    default:
      return "";
  }
}

/**
 * The reservation detail pane (task 12.11 continued, #464; actions #616).
 *
 * It shipped read-only, and its own comment listed what was deferred: "message / guests /
 * change time / resend / refund / cancel all defer, and refund waits on #472 besides". #616
 * lands three of those — cancel, refund, resend. Message, guests and change-time still defer.
 *
 * The pane is the same component in both form factors; the route decides whether it sits
 * beside the grid or replaces it.
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
  actions,
}: {
  v: ReservationDetailView;
  /** Balance-link state from the query string (11.2b) — the minted URL, or why not. */
  balance?: { url?: string | undefined; err?: string | undefined; date: string; filter: string } | undefined;
  /** Cancel / refund / resend state (#616). Absent ⇒ the pane stays read-only. */
  actions?: PaneActionState | undefined;
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

        {/* The balance link (11.2b, DEC-107). Shown only when money is actually owed — a
            "collect balance" button on a settled booking is a trap. The operator sends the
            link; the customer pays; the webhook writes the payment. Nothing is charged or
            written here, so re-minting is free and needs no confirmation.

            **Two more states must hide it (#616), both created or exposed by refunds:**

            - CANCELLED. `createBalanceCheckout` has refused this since 11.2b (`not_active`) and
              the copy for that refusal exists at the top of this file, but nothing could reach
              it: the button rendered on a cancelled booking and errored on press. Now that
              bookings can actually BE cancelled, that dead end is on the common path.
            - REFUNDED. A refund reduces `paid`, so `balanceOwedCents` goes back UP
              (`payment-config.ts:136`). Left alone, the pane would offer to re-bill a customer
              for money the operator had just handed back — with `createBalanceCheckout` happy
              to mint that charge, because from its side a balance is genuinely owed. */}
        {money.priceKnown &&
          money.balanceCents > 0 &&
          v.status === "booked" &&
          money.refundedCents === 0 &&
          balance && (
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

        {actions && <PaneActions v={v} actions={actions} />}
      </div>
    </div>
  );
}

/**
 * Cancel / refund / resend (#616) — the actions the pane's own header comment used to list as
 * deferred. All three are plain `<form>` posts: no client JS, so they work on the operator's
 * phone with a dead connection to the CDN, same as every other control here.
 */
function PaneActions({
  v,
  actions,
}: {
  v: ReservationDetailView;
  actions: PaneActionState;
}): React.ReactNode {
  const hidden = (
    <>
      <input type="hidden" name="reservationId" value={v.reservationId} />
      <input type="hidden" name="date" value={actions.date} />
      <input type="hidden" name="filter" value={actions.filter} />
    </>
  );
  const cancelled = v.status === "cancelled";
  const confirmingRefund = actions.confirmingRefundCents !== undefined;
  /**
   * **A confirm screen shows its own two buttons and nothing else** (operator, 2026-08-10).
   *
   * The first cut left the refund box live underneath an open cancel confirm. Two money
   * controls armed at once, one of them mid-question, and nothing saying which the red button
   * belonged to — "kind of confusing" was the operator's read, and it is worse than confusing
   * on a surface where the wrong press moves real money. Hidden rather than disabled: a greyed
   * refund box beside an open cancel still invites reading the two together, and the question
   * on screen is not "which of these do you want" but "are you sure about this one".
   */
  const confirming = confirmingRefund || actions.confirmingCancel;

  return (
    <div
      // The scroll anchor every action redirects to. A server action's `redirect()` is a full
      // navigation, so without it each press lands you back at the top of the page and you
      // scroll down to find the confirm you just opened — the defect #690 fixed on `/book`,
      // which is why `AppLink` carries `scroll={false}`. That prop cannot reach a form POST;
      // a fragment can, with no JS.
      id="booking-actions"
      className="mt-4 scroll-mt-4 border-t border-line pt-3"
      data-testid="reservation-actions"
    >
      <Section title="Actions" />

      {actions.done && (
        <p className="mb-2 rounded-lg border border-line bg-bg px-3 py-2 text-xs text-ink" data-testid="action-done">
          {actions.done}
        </p>
      )}
      {actions.error && (
        <p className="mb-2 text-xs text-bad" data-testid="action-error">
          {actions.error}
        </p>
      )}

      {/* REFUND. Available whether or not the booking is cancelled — a goodwill partial on a
          trip that is still sailing is a real thing an operator does.

          TWO STEPS, like the cancel. This is the only control here that moves real money in a
          single press, and unlike a cancellation a wrong amount leaves no trace that says so —
          $538.80 and $53.88 look equally plausible on the row afterwards. The confirm screen
          states the figure back in words the operator did not type. */}
      {actions.refundableCents > 0 && actions.confirmingRefundCents !== undefined && (
        <form action={refundBooking} className="mb-2" data-testid="refund-confirm">
          {hidden}
          <input type="hidden" name="expectedRefunded" value={actions.refundedTotalCents} />
          <input
            type="hidden"
            name="amount"
            value={(actions.confirmingRefundCents / 100).toFixed(2)}
          />
          <p className="mb-2 text-sm text-ink">
            Refund <b className="font-mono">{formatCents(actions.confirmingRefundCents)}</b> to the
            card it came from?
          </p>
          <p className="mb-2 text-xs text-muted">
            This moves real money now. Muster cannot take it back — a mistake has to be collected
            from the customer again.
          </p>
          <div className="flex gap-2">
            <SubmitButton
              data-commits="refund"
              className="min-h-[44px] flex-1 rounded-lg border border-line bg-bad px-3 text-sm font-medium text-white"
            >
              Yes, refund {formatCents(actions.confirmingRefundCents)}
            </SubmitButton>
            <AppLink
              href={actions.refundBackHref}
              className="flex min-h-[44px] items-center rounded-lg border border-line px-3 text-sm text-muted"
            >
              Do Not Refund
            </AppLink>
          </div>
        </form>
      )}

      {/* This used to hold its SPACE (`invisible`) while the cancel confirm was open, so the
          confirm could not drift — removing 110px from above it slid the block up, and on
          resolve the refund box slid back down 22px into the coordinates just pressed. That was
          the right fix at the time and it left a blank gap the operator (rightly) wanted gone.
          
          It collapses now because the hazard changed underneath it: **Refund became a two-step.**
          The button that lands in the press point no longer moves money — it opens a confirm the
          operator reads and can back out of. The invariant was never "nothing may reflow into the
          press point"; it is "nothing that COMMITS in one press may". Controls that commit carry
          `data-commits`, and the #718 e2e asserts against exactly those. */}
      {!confirming && actions.refundableCents > 0 && (
        <form action={startRefund} className="mb-2" data-testid="refund-form">
          {hidden}
          {/* The compare-and-swap token: the refunded total this screen was DRAWN against.
              Stripe's idempotency key cannot stop a double-submit here, because the second
              press computes a different cumulative total and therefore keys differently. */}
          <input type="hidden" name="expectedRefunded" value={actions.refundedTotalCents} />
          <label className="mb-1 block text-xs text-muted" htmlFor="refund-amount">
            Refund up to {formatCents(actions.refundableCents)}
          </label>
          <div className="flex gap-2">
            <input
              id="refund-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={actions.refundPrefill}
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 font-mono text-sm text-ink"
              aria-describedby="refund-help"
            />
            <SubmitButton className="min-h-[44px] rounded-lg border border-line bg-ink px-3 text-sm font-medium text-white">
              Refund
            </SubmitButton>
          </div>
          <p id="refund-help" className="mt-1 text-[11px] text-faint">
            Goes back on the card it came from. Split across the deposit and balance charges
            automatically, newest first.
          </p>
        </form>
      )}

      {/* A HALF-APPLIED CANCEL (security review). `cancelReservation` writes the reservation,
          then the event; if anything between them throws, the reservation reads Cancelled while
          the event stays `scheduled` — the boat still held, neighbours still unsellable, the crew
          never told, and nothing on screen saying so. The core repairs this on a re-run and its
          comment says so, but the UI hid the only control that could trigger one: `!cancelled`
          removed the whole cancel block the moment the first write landed. So the repair gets its
          own affordance, and it states the consequence rather than the mechanism. */}
      {!confirming && cancelled && actions.needsRelease && (
        <form action={cancelBooking} className="mb-3" data-testid="release-repair">
          {hidden}
          <input type="hidden" name="by" value="operator" />
          <p className="mb-2 text-xs text-bad">
            This booking is cancelled but its boat was never released — the departure is still
            blocking that hull, and the crew were never told they’re off. Finish it:
          </p>
          <SubmitButton
            data-commits="release"
            className="min-h-[44px] w-full rounded-lg border border-line bg-ink px-3 text-sm font-medium text-white"
          >
            Release the boat
          </SubmitButton>
        </form>
      )}

      {/* CANCEL. Two steps, because it is the one action here that cannot be undone by pressing
          the same button again — the boat is released and the crew have been told. */}
      {!confirmingRefund &&
        !cancelled &&
        (actions.confirmingCancel ? (
          <form action={cancelBooking} className="mb-3" data-testid="cancel-confirm">
            {hidden}
            <p className="mb-2 text-xs text-muted">
              This frees the boat and tells the crew they’re off
              {actions.refundableCents > 0
                ? ", and refunds the amount you set here in the same press."
                : ". Nothing has been paid on this booking, so there is nothing to refund."}
            </p>
            {/* Both figures are rendered NEXT TO their option rather than in one line that
                updates on selection. With no client JS a single figure could not follow the
                radio, and a number that silently belongs to the other choice is worse than no
                number at all on a screen whose whole job is deciding an amount. */}
            <fieldset className="mb-2">
              <legend className="sr-only">Who cancelled?</legend>
              {(
                [
                  ["customer", "The customer asked", actions.quoteCustomerCents],
                  ["operator", "We cancelled — weather, crew, mechanical", actions.quoteOperatorCents],
                ] as const
              ).map(([value, label, cents], i) => (
                <label
                  key={value}
                  className="flex min-h-[44px] items-center gap-2 border-b border-line py-1 last:border-0 text-sm text-ink"
                >
                  <input type="radio" name="by" value={value} defaultChecked={i === 0} />
                  <span className="flex-1">{label}</span>
                  <span className="font-mono text-xs text-muted">{formatCents(cents)}</span>
                </label>
              ))}
            </fieldset>

            {/* **The amount is an OVERRIDE, not a prefill, and that is the whole point.**
                
                The figures above belong to their radio. A prefilled box cannot follow a radio
                without client JS, so prefilling it would mean: pick "We cancelled", forget to
                retype, and refund at the customer rate — a wrong amount of real money, chosen by
                a field that looked already-correct. Leaving it BLANK makes the server compute the
                figure for whichever reason was actually posted, so the two can never disagree.
                Typing in it is a deliberate act that overrides both. */}
            {actions.refundableCents > 0 && (
              <div className="mb-2">
                <label className="mb-1 block text-xs text-muted" htmlFor="cancel-refund-amount">
                  Refund — leave blank to use the amount for the reason you picked
                </label>
                <input
                  id="cancel-refund-amount"
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="blank = the amount for your reason"
                  className="min-h-[44px] w-full rounded-lg border border-line bg-bg px-2 font-mono text-sm text-ink"
                  aria-describedby="cancel-refund-help"
                />
                <p id="cancel-refund-help" className="mt-1 text-[11px] text-faint">
                  Enter <span className="font-mono">0</span> to cancel without refunding anything.
                  Up to {formatCents(actions.refundableCents)}.
                </p>
                {/* Fills the box to match the chosen reason, and backs off the moment the
                    operator types. Purely additive — with JS off the box stays blank, and blank
                    already means "use the figure for the reason posted" (DEC-147 rule 2). */}
                <RefundAmountSync
                  inputId="cancel-refund-amount"
                  radioName="by"
                  amountByReason={{
                    customer: Math.min(actions.refundableCents, actions.quoteCustomerCents),
                    operator: Math.min(actions.refundableCents, actions.quoteOperatorCents),
                  }}
                />
              </div>
            )}
            <input type="hidden" name="expectedRefunded" value={actions.refundedTotalCents} />

            <div className="flex gap-2">
              <SubmitButton
                data-commits="cancel"
                className="min-h-[44px] flex-1 rounded-lg border border-line bg-bad px-3 text-sm font-medium text-white"
              >
                {actions.refundableCents > 0 ? "Cancel and refund" : "Cancel this booking"}
              </SubmitButton>
              <AppLink
                href={actions.backHref}
                className="flex min-h-[44px] items-center rounded-lg border border-line px-3 text-sm text-muted"
              >
                Do Not Cancel
              </AppLink>
            </div>
          </form>
        ) : (
          <AppLink
            href={actions.cancelHref}
            className="mb-2 flex min-h-[44px] items-center justify-center rounded-lg border border-line px-3 text-sm font-medium text-ink"
            data-testid="cancel-start"
          >
            Cancel booking
          </AppLink>
        ))}

      {/* RESEND, last (operator, 2026-08-10) — and rendered even when it cannot be used, with
          `disabled`, which is the DEC-152 pattern rather than a stylistic choice.
          
          Putting it below the cancel block means that when that block collapses after a press,
          resend reflows UP into the coordinates the thumb just left — the #718 defect, measured
          at 8px on the first arrangement of this very section. Disabling it makes the thing that
          lands under the thumb inert instead of moving it somewhere else, and the disabled state
          is honest rather than defensive: `resendConfirmation` already refuses a cancelled
          booking server-side, because the body says the trip is booked and carries a live manage
          link. Green-vs-grey survives greyscale; the reason is in the line beneath.

          Hidden entirely while a confirm is open — see `confirming` above. */}
      {!confirming && (
          <form action={resendConfirmation}>
          {hidden}
          <SubmitButton
            data-commits="resend"
            disabled={!actions.canResend || cancelled}
            className="min-h-[44px] w-full rounded-lg border border-line px-3 text-sm text-ink disabled:cursor-not-allowed disabled:text-faint"
          >
            Resend confirmation + manage link
          </SubmitButton>
          {(cancelled || !actions.canResend) && (
            <p className="mt-1 text-[11px] text-faint">
              {cancelled
                ? "Cancelled bookings can’t be re-confirmed — it would tell the customer their trip is on."
                : "No email or phone on this booking, so there’s nowhere to send."}
            </p>
          )}
        </form>
      )}

    </div>
  );
}

function Faint({ children }: { children: React.ReactNode }) {
  return <span className="text-faint">{children}</span>;
}
