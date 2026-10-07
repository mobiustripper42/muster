import { formatCents, type ReservationDetailView } from "@core/reservations/calendar-detail.js";
import { AppLink } from "../../../../../components/ui/app-link";
import { Notice } from "../../../../../components/ui/notice";
import { UnsavedGuard } from "../../../../../components/ui/unsaved-guard";
import { PANE_HEAD, clockTime, formatShortDay } from "../calendar-view";
import { CopyButton } from "../../../../../components/ui/copy-button";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { RefundAmountSync } from "../../../../../components/admin/refund-amount-sync";
import {
  cancelBooking,
  createBalanceLink,
  refundBooking,
  reissueBookingLink,
  resendConfirmation,
  startRefund,
} from "./actions";
import { PhoneBookingActions, type UnpaidActionState } from "./phone-booking-actions";
import { paymentLinkSentMessage } from "./payment-link-message";
import { Radio } from "../../../../../components/ui/choice";
import { Input } from "../../../../../components/ui/input";
import { Card } from "../../../../../components/ui/card";

/**
 * Everything the actions block needs, resolved by the route (#616). Passed in rather than
 * derived in `buildReservationDetail` because two of these need a CLOCK — the refund quotes
 * depend on how much notice the cancellation gives — and the detail view model is pure.
 */
export interface PaneActionState {
  date: string;
  filter: string;
  /** `list` when the calendar behind the pane is the List (issue #1079). */
  view: string;
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
  /**
   * Which cancellation reason the confirm screen opens on (#780). "customer" unless a refused
   * cancel is being re-offered, in which case it is what the operator had picked — the two
   * options quote different refunds, so resetting it silently changes the amount on screen.
   */
  cancelBy: "customer" | "operator";
  /** Cents awaiting confirmation, from `?refundConfirm=` — the two-step's second screen. */
  confirmingRefundCents?: number | undefined;
  /** …and the href that backs out of it. */
  refundBackHref: string;
  canResend: boolean;
  /**
   * The customer's manage URL, for copying into a browser (#686). **Present only off
   * production** — it is a live bearer credential, so on a production deploy it must not reach
   * the operator's clipboard, one paste away from a Slack thread. Same posture as
   * the dev-only routes under DEC-057.
   *
   * #741 made the code revocable, which weakens but does not retire that argument: the remedy
   * (notice the leak, press Replace their link) depends on someone realising it leaked, and a
   * leaked link works until they do. Revisiting the gate is deliberately out of #741's scope.
   * The resend path has no such exposure: it puts the code only where it already was, in the
   * customer's own inbox.
   */
  manageUrl?: string | undefined;
  /** True when `manageUrl` is being shown because a reissue just happened — changes the copy
   *  from "here is their link" to "here is their NEW link, their old one is dead". */
  justReissued?: boolean | undefined;
  /**
   * The reservation is cancelled but its event is still `scheduled` — a half-applied cancel.
   * The boat is silently still held: neighbouring departures stay unsellable and the crew shift
   * never collapsed. `cancelReservation` repairs this on a re-run, so the pane has to offer one.
   */
  needsRelease: boolean;
  /** Outcome copy from the last action, if any. */
  done?: string | undefined;
  error?: string | undefined;
  /**
   * A refusal restored this pane's amount boxes from the draft (#781).
   *
   * The unsaved-work guard needs it: a refused submission is unsaved work whatever the boxes
   * currently hold, and the guard's usual baseline cannot see that because the draft comes back
   * as the form's own DEFAULTS. Resolved here rather than in the pane because the pane is handed
   * a flat view model and the draft (and its reservation-id match) lives on the route. See
   * DEC-160's 2026-08-25 amendment.
   */
  restoredFromRefusal: boolean;
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
    case "disputed":
      return "There’s a chargeback on this booking. The balance reads as owed because the bank pulled the money back — billing again would make it two disputes, not one. Resolve it in Stripe first.";
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
// REFACTOR QUEUE — cognitive complexity 55, against a ceiling of 40 (#909).
// Baselined, NOT accepted: this is on the list in the tracking issue. The ceiling
// ratchets down as the list shrinks, so this disable is meant to be deleted.
// eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing, score 55
export function actionMessage(
  kind: string,
  value: string,
  opts: { movedCents?: number; refundableCents?: number; email?: string; phone?: string } = {},
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
    case "resent": {
      // `value` is `<email>-<sms>`, each `sent` | `failed` | `absent` (#686). Naming the address
      // and number matters more than it looks: the operator is usually on the phone to the
      // customer, and "we've emailed you" is only useful if it says WHICH address — a typo'd
      // one at booking is exactly why they are on the phone.
      const [emailState, smsState] = value.split("-");
      const to = (state: string | undefined, contact: string | undefined, verb: string): string =>
        state === "sent" && contact ? `${verb} ${contact}` : "";
      const sent = [to(emailState, opts.email, "emailed"), to(smsState, opts.phone, "texted")].filter(
        Boolean,
      );
      // A failure here is partial by construction — the action redirects to `resendErr` when
      // nothing got out — so this always has something to report as sent alongside it.
      const failed = [
        emailState === "failed" ? "the email failed" : "",
        smsState === "failed" ? "the text failed" : "",
      ].filter(Boolean);
      const head = sent.length ? `Link ${sent.join(" and ")}.` : "Link sent again.";
      if (failed.length) return `${head} But ${failed.join(" and ")} — try again or call them.`;
      // `absent` covers two different facts and the operator needs them apart:
      //   - the BOOKING has no such contact — nothing to fix, nothing to chase;
      //   - the DEPLOYMENT has no channel for a contact that IS there — the customer has a phone
      //     number sitting untried, which is the difference between "done" and "also call them".
      // Silence on either reads as "both went".
      const missing = [
        emailState === "absent" && !opts.email ? "email" : "",
        smsState === "absent" && !opts.phone ? "phone" : "",
      ].filter(Boolean);
      // `logged` (#955) lands here too, and for the operator it means the same thing as `absent`
      // with a contact on file: the customer did not get it, so also call them. The two differ
      // only in whether a recoverable record exists on the server, which is not their problem.
      // Rendering it as "texted" is the exact defect `resend-booking-link.ts`'s header forbids.
      const untried = [
        (emailState === "absent" || emailState === "logged") && opts.email ? `email (${opts.email})` : "",
        (smsState === "absent" || smsState === "logged") && opts.phone ? `text (${opts.phone})` : "",
      ].filter(Boolean);
      const tail = [
        missing.length ? `No ${missing.join(" or ")} on this booking.` : "",
        untried.length
          ? `Not tried: ${untried.join(" and ")} — no channel configured for it here.`
          : "",
      ].filter(Boolean);
      return tail.length ? `${head} ${tail.join(" ")}` : head;
    }
    case "reissued": {
      // Same `<email>-<sms>` pair as `resent`, but the headline has to carry the destructive half:
      // the operator just made the customer's old link stop working, and if the send went to only
      // one of two channels they need to know which one carries the replacement.
      const [emailState, smsState] = value.split("-");
      const sent = [
        emailState === "sent" && opts.email ? `emailed ${opts.email}` : "",
        smsState === "sent" && opts.phone ? `texted ${opts.phone}` : "",
      ].filter(Boolean);
      // #955: a `logged` channel wrote the message to the server and did not deliver it. On a
      // reissue that is worse than on a resend — the old link is already dead, so a customer who
      // is not told is locked out rather than merely uninformed.
      const undelivered = [
        emailState === "logged" && opts.email ? `email (${opts.email})` : "",
        smsState === "logged" && opts.phone ? `text (${opts.phone})` : "",
      ].filter(Boolean);
      const head = sent.length ? `New link ${sent.join(" and ")}.` : "New link issued.";
      const warn = undelivered.length
        ? ` NOT delivered by ${undelivered.join(" or ")} — no channel configured here, so call them.`
        : "";
      return `${head} Their old link no longer works.${warn}`;
    }
    case "reissueErr":
      switch (value) {
        case "cancelled":
          return "This booking is cancelled — there’s no live trip to issue a link for.";
        case "no_contact":
          return "This booking has no email or phone on it, so a new link would have nowhere to go.";
        case "not_muster":
          return "Xola bookings have no Muster manage link.";
        case "reservation_missing":
          return "That reservation no longer exists.";
        // The old link IS dead and the new one did not get out. Since 2026-08-15 the new link is
        // on screen in this exact case, so the instruction is "read it to them" rather than the
        // dead end this used to be ("they have no working link, call them" — with nothing the
        // operator could actually say once they had).
        case "sent_nothing":
          return "The old link was replaced, but nothing could be sent. Their new link is below — read it to them or send it yourself.";
        // The mixed state: new link delivered, old one NOT shut off. Says so, because the
        // operator pressed this to close a link and would otherwise assume it closed.
        case "old_link_alive":
          return "The new link was sent, but their OLD link could not be switched off and may still open the booking. Press this again in a moment; if it keeps failing, say so — the old link is still live until it works.";
        default:
          return "Couldn’t issue a new link just now. Their existing link still works.";
      }
    case "cancelErr":
      switch (value) {
        case "not_muster":
          return "This booking is Xola's — cancel it there, or the next import will bring it back.";
        case "reservation_missing":
          return "That reservation no longer exists.";
        case "not_booked":
          return "This checkout hasn’t been paid, so there is nothing to cancel. It lapses on its own.";
        default:
          return "Couldn’t cancel just now. Try again in a moment.";
      }
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
        case "not_booked":
          return "This checkout hasn’t been paid — no money was taken, so there is nothing to refund.";
        case "stripe_not_configured":
          return "Stripe isn’t configured on this deployment, so nothing can be refunded from here.";
        default:
          return "Couldn’t refund just now. Nothing moved. Try again in a moment.";
      }
    case "resendErr":
      switch (value) {
        case "cancelled":
          return "This booking is cancelled — resending would confirm a trip that isn’t sailing.";
        case "no_contact":
          return "This booking has no email or phone on it, so there’s nowhere to send.";
        case "not_muster":
          return "Xola bookings have no Muster manage link.";
        // The one below means NOTHING was attempted — a deployment problem, not a bad booking.
        // Retrying changes nothing until the deployment does, so the copy says so rather than
        // inviting a second press.
        //
        // `not_configured` ("APP_BASE_URL is unset") was a third, removed at #1007. It could only
        // be produced on a deploy that cannot build a link at all, which now throws at the
        // resolver instead of returning a tidy skip — and on a preview, where it used to fire
        // every time because the variable is scoped to Production by design (DEC-057), the resend
        // simply works. The string travels as a URL param, so nothing in the type system was ever
        // going to name this case; it was found by grepping the render sites. `messaging_off` went
        // the same way at issue #761: `MESSAGING` switches crew messaging, never a customer send.
        case "no_channels":
          return "No email or SMS channel is configured on this deployment, so nothing was sent.";
        case "all_failed":
          return "Nothing got out — every channel this booking has failed. Check the logs, or call them.";
        case "nothing_sent":
          return "Nothing was sent — this deployment has no channel for the contact details on this booking. Call them, or add the missing contact.";
        default:
          return "Couldn’t send just now. Try again in a moment.";
      }
    default:
      return "";
  }
}

/**
 * The booking pane (task 12.11 continued, #464; actions #616; one pane for every booking, issue
 * #1104 part 2).
 *
 * Every booking renders here — paid, awaiting payment, cancelled, Xola — in the approved mockup's
 * shape (`calendar-pane-1104.html`): the customer's name with a status pill, a meta line, then Trip,
 * Contact and Money cards, then the actions. The header is shaped like the slot pane's, so every
 * card on the calendar opens the same kind of thing. An unpaid phone booking used to have a pane of
 * its own, styled nothing like this one, so a booking changed its whole layout the moment it was
 * paid; now only its actions differ (`PhoneBookingActions`).
 *
 * The pane is the same component in both form factors; the route's `MasterDetail` decides whether
 * it sits beside the grid or replaces it.
 *
 * Add-ons are omitted (no per-reservation selection exists), and there is no waiver row: the real
 * waiver is its own module (issue #1112) — see the module note in `src/reservations/calendar-detail.ts`.
 * An unpaid booking's money reads "Fare" and "Extra guests", not the mockup's "Fare, up to 10
 * guests" and "2 extra guests · $40.00": the frozen invoice keeps the extras' total but not how many
 * guests the fare covers or the per-guest price, and reading those off live config could contradict
 * the figure the customer was quoted.
 */

function Row({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  /** On the VALUE, so a test reads the figure and not the label beside it. */
  testId?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <span className="text-right text-sm text-ink" {...(testId ? { "data-testid": testId } : {})}>
        {children}
      </span>
    </div>
  );
}

function PaneCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card aria-label={title} as="section">
      <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </Card>
  );
}

function Cents({ cents }: { cents: number }) {
  return <span className="font-mono">{formatCents(cents)}</span>;
}

/** Basis points → "7.25%". */
function pct(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/**
 * The pill beside the name. `admin` is the unpaid source (DEC-163): once paid the row turns
 * `muster`, so the source alone says "awaiting payment".
 */
function bookingState(v: ReservationDetailView): { label: string; tone: string } {
  if (v.status === "cancelled") return { label: "Cancelled", tone: "border-line bg-card text-muted" };
  if (v.source === "admin") return { label: "Awaiting payment", tone: "border-warn-line bg-warn-bg text-warn" };
  return { label: "Booked", tone: "border-ok-line bg-ok-bg text-ok" };
}

const HOW_BOOKED: Record<ReservationDetailView["source"], string> = {
  admin: "Booked by phone",
  xola: "Booked on Xola",
  muster: "Booked online",
};

/** "3:30 PM · Brew 3 · Sat, Oct 10 · Booked online". */
function metaLine(v: ReservationDetailView): string {
  return [
    v.time ? clockTime(v.time) : "",
    v.vesselName ?? "",
    v.date ? formatShortDay(v.date) : "",
    // Paid, a phone booking is `muster` like any other; who sold it is on its history (#1082).
    v.soldByPhone ? HOW_BOOKED.admin : HOW_BOOKED[v.source],
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ReservationDetailPane({
  v,
  balance,
  actions,
  unpaid,
  waivers,
  comped,
  children,
}: {
  v: ReservationDetailView;
  /** The render right after a comp was booked (16.5): `1` confirmed, `error` written but not
   *  confirmed. Absent otherwise. */
  comped?: string | undefined;
  /** Balance-link state from the query string (11.2b) — the minted URL, or why not. */
  balance?: { url?: string | undefined; err?: string | undefined; date: string; filter: string; view: string } | undefined;
  /** Cancel / refund / resend state (#616) for a Muster booking. Absent ⇒ no such actions. */
  actions?: PaneActionState | undefined;
  /** An unpaid phone booking's state (16.1): the just-booked notice and its cancel. */
  unpaid?: UnpaidActionState | undefined;
  /** The departure's waivers, check-in and count (18.8). Absent ⇒ no card: an unpaid phone
   *  booking has no departure yet, and a card that failed to load is left out rather than shown
   *  wrong. */
  waivers?: WaiverCardView | undefined;
  /** What follows the actions (the booking's history). Inside the pane rather than after it, so
   *  the pinned title block stays up for the whole scroll (issue #1128): a sticky element only
   *  sticks while its own container is on screen. */
  children?: React.ReactNode;
}) {
  const cancelled = v.status === "cancelled";
  const state = bookingState(v);

  return (
    <div className="flex flex-col gap-3">
      {/* Pinned under Close ✕ as the pane scrolls on desktop (issue #1128). */}
      <div data-testid="pane-head" className={PANE_HEAD}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold text-ink">{v.customerName}</h2>
        <span
          data-testid="booking-state"
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${state.tone}`}
        >
          {state.label}
        </span>
      </div>
      <p className="text-sm text-muted">{metaLine(v)}</p>
      </div>

      {unpaid?.justBooked && !cancelled ? <JustBooked v={v} linkSent={unpaid.linkSent} /> : null}
      {comped === "1" ? (
        <Notice tone="ok">
          {/* Not "they've been sent their confirmation": the send is best-effort and this redirect
              doesn't know whether it landed. Resend is below if they say it never came. */}
          Booked as a comp — nothing to pay, so no payment link went out.
        </Notice>
      ) : null}
      {comped === "error" ? (
        <Notice tone="bad">
          The comp was saved but didn’t confirm, so it isn’t booked yet. Reload in a moment; if it
          still reads Awaiting payment, cancel it and book it again.
        </Notice>
      ) : null}

      {/* A cancelled booking keeps only what is still useful: money, contact and history. */}
      {cancelled ? null : <TripCard v={v} />}

      {cancelled || !waivers ? null : <WaiversCard w={waivers} />}

      <PaneCard title="Contact">
        <Row label="Mobile">
          {v.phone ? <span className="font-mono text-[13px]">{v.phone}</span> : <Faint>—</Faint>}
        </Row>
        <Row label="Email">
          {v.email ? <span className="break-all font-mono text-[12px]">{v.email}</span> : <Faint>—</Faint>}
        </Row>
      </PaneCard>

      <PaneCard title="Money">
        <MoneyRows v={v} />
      </PaneCard>

      {balance ? <BalanceLink v={v} balance={balance} /> : null}

      {actions && <PaneActions v={v} actions={actions} />}
      {unpaid && <PhoneBookingActions reservationId={v.reservationId} cancelled={cancelled} state={unpaid} />}
      {children}
    </div>
  );
}

/**
 * The note right after the operator books by phone, with where the payment link went (issue #1082
 * part B). A link that reached nobody gets its own warning rather than riding under "Booked" in
 * green, because the operator may still have the customer on the line to read it out.
 */
function JustBooked({ v, linkSent }: { v: ReservationDetailView; linkSent: string | undefined }) {
  const sent = linkSent !== undefined ? paymentLinkSentMessage(linkSent, { phone: v.phone, email: v.email }) : null;
  return (
    <>
      <Notice tone="ok">
        Booked. The boat is held for {v.customerName} until they pay or you cancel it — it doesn’t
        expire on its own.{sent?.tone === "ok" ? ` ${sent.text}` : ""}
      </Notice>
      {sent?.tone === "bad" ? <Notice tone="bad">{sent.text}</Notice> : null}
    </>
  );
}

function TripCard({ v }: { v: ReservationDetailView }) {
  return (
    <PaneCard title="Trip">
      {v.offeringName && <Row label="Cruise">{v.offeringName}</Row>}
      <Row label="Guests">
        {v.guestCount}
        {v.capacity > 0 && <span className="font-normal text-muted"> of {v.capacity}</span>}
      </Row>
      {/* Crew is the shift view's job — cross-linked, never re-managed here (DEC-123). */}
      {v.crew && (
        <Row label="Crew">
          <AppLink href={`/admin/shift/${v.crew.shiftId}`} className="btn-quiet">
            {v.crew.filled}/{v.crew.required} crewed ↗
          </AppLink>
        </Row>
      )}
    </PaneCard>
  );
}

/** What the Waivers card shows (18.8) — the departure's lines, from `loadWaiverCard`. */
export interface WaiverCardView {
  signed: string;
  counted: string;
  href: string;
}

/**
 * The departure's waivers, check-in and count (18.8, issue #1122), with the way into the departure
 * page — where the signers, their details and the words they accepted are. The numbers are the
 * whole departure's; on a private charter that is this booking.
 */
function WaiversCard({ w }: { w: WaiverCardView }) {
  return (
    <PaneCard title="Waivers">
      <Row label="Signed">{w.signed}</Row>
      <Row label="Counted">{w.counted}</Row>
      <div className="pt-1">
        <AppLink href={w.href} className="btn-quiet">
          See waivers ›
        </AppLink>
      </div>
    </PaneCard>
  );
}

/**
 * Three shapes, one card. Awaiting payment itemises the invoice frozen at booking, in the checkout
 * summary's order — the figure the operator read out. Booked shows the derived fare, tax and tips.
 * Cancelled keeps only what was paid, what went back, and why nothing is owed.
 */
function MoneyRows({ v }: { v: ReservationDetailView }) {
  const money = v.money;
  if (!money.priceKnown) {
    return (
      <p className="text-xs text-muted">
        This departure has no recorded price, so the fare and balance can’t be derived.
      </p>
    );
  }
  const cancelled = v.status === "cancelled";
  return (
    <>
      {cancelled ? null : <ChargeRows v={v} />}
      {cancelled && v.invoice ? (
        <Row label="Was quoted">
          <Cents cents={v.invoice.amountDueNowCents} />
        </Row>
      ) : null}
      <div className={cancelled ? "" : "mt-1 border-t border-line pt-1"}>
        <Row label="Paid" testId="money-paid">
          <span className="font-mono font-semibold">{formatCents(money.paidCents)}</span>
        </Row>
        {money.refundedCents > 0 && (
          <Row label="Refunded">
            <Cents cents={money.refundedCents} />
          </Row>
        )}
        {/* **Say the word "chargeback" (issue #723).** Without this the dispute is arithmetically
            invisible on the surface an operator actually lands on from a bank or customer call:
            Paid drops, Owes rises, and it looks exactly like a deposit booking that hasn't
            settled. That misreading has an expensive next step — collect the balance — which is
            why the balance button is hidden and this line takes its place. Detail (reason,
            deadline, evidence) lives in Stripe. */}
        {money.disputed && (
          <Row label="Chargeback">
            <span className="text-bad">Disputed — money pulled back by the bank</span>
          </Row>
        )}
        <Row label="Owes" testId="money-owes">
          <OwesValue v={v} />
        </Row>
      </div>
    </>
  );
}

/**
 * **A cancelled booking owes nothing, and says why.** The model enforces it (issue #803 —
 * `balanceDueCents` returns 0 for a cancelled reservation), so the plain branch would read
 * "Settled" on its own; "Not owed — cancelled" says why, where "Settled" implies a bill that got
 * paid.
 */
function OwesValue({ v }: { v: ReservationDetailView }) {
  if (v.status === "cancelled") return <span className="text-muted">Not owed — cancelled</span>;
  if (v.money.balanceCents > 0) {
    return <span className="font-mono font-semibold">{formatCents(v.money.balanceCents)}</span>;
  }
  return <span className="font-semibold text-ok">Settled</span>;
}

function ChargeRows({ v }: { v: ReservationDetailView }) {
  const inv = v.invoice;
  if (inv) {
    return (
      <>
        <Row label="Fare">
          <Cents cents={inv.fareCents} />
        </Row>
        {inv.extrasCents > 0 && (
          <Row label="Extra guests">
            <Cents cents={inv.extrasCents} />
          </Row>
        )}
        <DiscountRow cents={inv.discountCents ?? 0} />
        {inv.gratuityCents > 0 && (
          <Row label={`Tip · ${pct(inv.gratuityBps)}`}>
            <Cents cents={inv.gratuityCents} />
          </Row>
        )}
        <Row label={`Tax · ${pct(inv.taxRateBps)}`}>
          <Cents cents={inv.taxCents} />
        </Row>
        {inv.serviceFeeCents > 0 && (
          <Row label={`Service fee · ${pct(inv.serviceFeeBps)}`}>
            <Cents cents={inv.serviceFeeCents} />
          </Row>
        )}
      </>
    );
  }
  return (
    <>
      {/* `fareCents` is what tax was charged on, after the discount (DEC-194); the Fare line shows
          it before, so the Discount line beneath it reads as what came off. */}
      <Row label="Fare">
        <Cents cents={v.money.fareCents + v.money.discountCents} />
      </Row>
      <DiscountRow cents={v.money.discountCents} />
      <Row label="Tax">
        <Cents cents={v.money.taxCents} />
      </Row>
      {/* Crew money: untaxed and outside the balance (see `calendar-detail.ts`) — one row per gratuity. */}
      {v.gratuityRows.map((g, i) => (
        <Row key={`${g.kind}-${i}`} label={tipLabel(g)}>
          <Cents cents={g.amountCents} />
        </Row>
      ))}
    </>
  );
}

/** The operator's dollars off (16.5, DEC-194). Nothing when there is none. */
function DiscountRow({ cents }: { cents: number }) {
  if (cents <= 0) return null;
  return (
    <Row label="Discount" testId="money-discount">
      <span className="font-mono">−{formatCents(cents)}</span>
    </Row>
  );
}

function tipLabel(g: ReservationDetailView["gratuityRows"][number]): string {
  if (g.kind !== "pre") return "Tip after the trip";
  return g.bps === undefined ? "Tip at checkout" : `Tip at checkout · ${pct(g.bps)}`;
}

/**
 * The balance link (11.2b, DEC-107). Shown only when money is actually owed — a "collect balance"
 * button on a settled booking is a trap. The operator sends the link; the customer pays; the
 * webhook writes the payment. Nothing is charged or written here, so re-minting is free and needs
 * no confirmation.
 *
 * **Three more states must hide it (#616, #723):**
 *
 * - CANCELLED. `createBalanceCheckout` refuses it (`not_active`); a button whose only outcome is
 *   an error is a dead end on the common path.
 * - REFUNDED. A refund reduces `paid`, so `balanceOwedCents` goes back UP (`payment-config.ts`).
 *   Left alone, the pane would offer to re-bill a customer for money the operator had just handed
 *   back — and `createBalanceCheckout` would happily mint that charge.
 * - DISPUTED (issue #723). The same trap from the other direction, and worse: a chargeback sets no
 *   `refundedCents` and `countsAsPaid` excludes the disputed row, so the balance jumps back to the
 *   full amount. `createBalanceCheckout` refuses it server-side too (`reason: "disputed"`).
 *
 * `status === "booked"` also keeps it off an unpaid phone booking, whose payment link is 16.1a's.
 */
function BalanceLink({
  v,
  balance,
}: {
  v: ReservationDetailView;
  balance: { url?: string | undefined; err?: string | undefined; date: string; filter: string; view: string };
}) {
  const money = v.money;
  const offered =
    money.priceKnown &&
    money.balanceCents > 0 &&
    v.status === "booked" &&
    money.refundedCents === 0 &&
    !money.disputed;
  if (!offered) return null;
  if (balance.url) {
    return (
      <div>
        <p className="mb-1.5 text-xs text-muted">
          Balance link for {formatCents(money.balanceCents)} — send it to the customer. It expires
          with the Stripe session; mint a fresh one any time.
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
      </div>
    );
  }
  return (
    <form action={createBalanceLink}>
      <input type="hidden" name="reservationId" value={v.reservationId} />
      <input type="hidden" name="date" value={balance.date} />
      <input type="hidden" name="filter" value={balance.filter} />
      <input type="hidden" name="view" value={balance.view} />
      <SubmitButton className="btn-primary min-h-[44px] w-full">Create balance link</SubmitButton>
      {balance.err && <p className="mt-1.5 text-xs text-bad">{balanceErrorMessage(balance.err)}</p>}
    </form>
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
      <input type="hidden" name="view" value={actions.view} />
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
      className="scroll-mt-4"
      data-testid="reservation-actions"
    >

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
          <div className="flex gap-2">
            <SubmitButton
              data-commits="refund"
              className="btn-danger min-h-[44px] flex-1"
            >
              Yes, refund {formatCents(actions.confirmingRefundCents)}
            </SubmitButton>
            <AppLink
              href={actions.refundBackHref}
              className="btn-secondary min-h-[44px]"
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
          <UnsavedGuard restored={actions.restoredFromRefusal} />
          {hidden}
          {/* The compare-and-swap token: the refunded total this screen was DRAWN against.
              Stripe's idempotency key cannot stop a double-submit here, because the second
              press computes a different cumulative total and therefore keys differently. */}
          <input type="hidden" name="expectedRefunded" value={actions.refundedTotalCents} />
          <label className="mb-1 block text-xs text-muted" htmlFor="refund-amount">
            Refund up to {formatCents(actions.refundableCents)}
          </label>
          <div className="flex gap-2">
            <Input
              id="refund-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={actions.refundPrefill}
              className="min-w-0 flex-1 font-mono"
            />
            <SubmitButton className="btn-primary min-h-[44px]">
              Refund
            </SubmitButton>
          </div>

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
            className="btn-primary min-h-[44px] w-full"
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
            <UnsavedGuard restored={actions.restoredFromRefusal} />
            {hidden}
            {/* Kept when the rest of the explanations were cut: the button covers the money,
                and nothing else on screen says a text lands on a crew member's phone. */}
            <p className="mb-2 text-xs text-muted">Frees the boat and tells the crew.</p>
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
              ).map(([value, label, cents]) => (
                <Radio
                  key={value}
                  name="by"
                  value={value}
                  defaultChecked={value === actions.cancelBy}
                  className="border-b border-line last:border-0"
                >
                  <span className="flex-1">{label}</span>
                  <span className="self-center font-mono text-xs text-muted">{formatCents(cents)}</span>
                </Radio>
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
                  Refund amount
                </label>
                <Input
                  id="cancel-refund-amount"
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="blank = the amount for your reason"
                  className="w-full font-mono"
                />
                {/* The box arrives prefilled with the policy figure, so nothing suggests zero is
                    allowed — and cancelling without refunding is a real choice inside the
                    14-day window. Four characters for a capability that otherwise needs
                    someone to have told you. */}
                <p className="mt-1 text-[11px] text-muted">0 = no refund</p>
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
                className="btn-danger min-h-[44px] flex-1"
              >
                {actions.refundableCents > 0 ? "Cancel and refund" : "Cancel this booking"}
              </SubmitButton>
              <AppLink
                href={actions.backHref}
                className="btn-secondary min-h-[44px]"
              >
                Do Not Cancel
              </AppLink>
            </div>
          </form>
        ) : (
          <AppLink
            href={actions.cancelHref}
            className="btn-secondary mb-2 flex min-h-[44px]"
            data-testid="cancel-start"
          >
            Cancel booking…
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
          {/* Only the no-contact reason survives. A greyed resend under a "Cancelled" chip
            explains itself; a greyed resend on a live booking has no visible cause at all. */}
          {!actions.canResend && (
            <p className="mb-1 text-[11px] text-muted">No email or phone on this booking.</p>
          )}
          <SubmitButton
            data-commits="resend"
            disabled={!actions.canResend || cancelled}
            className="btn-secondary min-h-[44px] w-full"
          >
            Resend confirmation + manage link
          </SubmitButton>

        </form>
      )}

      {/* REISSUE (#741) — behind a `<details>` disclosure, deliberately.

          Resend and reissue sit one above the other and read almost the same, but one is
          harmless and the other breaks the link the customer already has. A plain second button
          beside "Resend" is a mis-tap that strands someone. `<details>` costs the operator one
          extra tap, needs no client JS (DEC-026), and puts the consequence in front of them at
          the moment they are deciding rather than in a notice afterwards.

          Same disabled conditions as resend: without a contact there is nowhere to send the new
          link, and a cancelled booking has no live trip to issue one for. */}
      {!confirming && (
        <details className="mt-2">
          <summary className="list-none text-[13px] text-muted underline decoration-dotted">
            Customer lost their link, or it leaked?
          </summary>
          <form action={reissueBookingLink} className="mt-2">
            {hidden}
            <p className="mb-1.5 text-[11px] text-muted">
              Issues a new link and sends it. The link they have now will stop working — use
              “Resend” instead if they just mislaid it.
            </p>
            <SubmitButton
              data-commits="reissue"
              disabled={!actions.canResend || cancelled}
              className="btn-secondary min-h-[44px] w-full"
            >
              Replace their link
            </SubmitButton>
          </form>
        </details>
      )}

      {/* The manage link (#686; gate revised 2026-08-15).
          Off production it always renders. On production it renders only on the load right after
          a reissue — the page decides, this just draws whatever it was handed. Absence is by
          construction rather than by hiding, so there is no markup to inspect for a link that
          shouldn't be there.
          It exists because there was otherwise NO way to reach the manage page — under the old
          HMAC scheme that meant hand-running it in a `node -e` one-liner, which is why the #619
          test plan's step for that page was unusable as written. */}
      {!confirming && actions.manageUrl && (
        <div className="mt-3 border-t border-line pt-3" data-testid="manage-link-block">
          {/* Two different situations, and the copy has to say which. After a reissue this is a
              brand-new link the operator is about to hand over — most likely by reading it out,
              which is what the 14-character alphabet was chosen for. At rest (dev only) it is
              just the customer's current link, sitting there. */}
          <p className="mb-1.5 text-xs text-muted">
            {actions.justReissued ? (
              <>
                <b className="text-ink">Their new link.</b> Safe to read out or paste — their old
                one no longer works. It won&rsquo;t be shown again after you leave this page.
              </>
            ) : (
              <>The customer&rsquo;s manage link. It opens the booking for anyone holding it.</>
            )}
          </p>
          <div className="flex items-center gap-2">
            <span
              className="min-w-0 flex-1 select-all truncate rounded-lg border border-line bg-bg px-2 py-1.5 font-mono text-[11px] text-muted"
              data-testid="manage-link"
            >
              {actions.manageUrl}
            </span>
            {/* "Copy manage link", not "Copy link" — the balance block above already has a
                "Copy link" button, and two controls with the same accessible name in one pane
                carrying DIFFERENT URLs (a Stripe checkout vs a capability token) is a real
                ambiguity, for a screen reader and for anyone scanning. The e2e caught it as a
                strict-mode violation; it would have reached the operator as a wrong paste. */}
            <CopyButton value={actions.manageUrl} label="Copy manage link" />
          </div>
        </div>
      )}

    </div>
  );
}

function Faint({ children }: { children: React.ReactNode }) {
  return <span className="text-muted">{children}</span>;
}
