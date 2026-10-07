import { PAYMENT_LINK_HOURS } from "@core/reservations/payment-link.js";
import { AppLink } from "../../../../../components/ui/app-link";
import { CopyButton } from "../../../../../components/ui/copy-button";
import { Notice } from "../../../../../components/ui/notice";
import { Radio } from "../../../../../components/ui/choice";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { errCopyFor } from "../../../../lib/err-copy";
import { cancelPhoneBooking, sendPaymentLinkAgain, type PhoneCancelErr } from "./actions";
import { paymentLinkSentMessage } from "./payment-link-message";

/**
 * The actions for an operator's phone booking that has not been paid (16.1, §2.10.6, DEC-163).
 *
 * It used to be a whole pane of its own, styled nothing like the paid one, so a booking changed its
 * layout the moment it was paid. Since issue #1104 part 2 every booking renders through
 * `ReservationDetailPane`, and only these actions differ: an unpaid booking has no Event, no money
 * received and nothing to refund. What is left is the payment link the customer pays through
 * (issue #1082 part B) — sent automatically at booking, resent or copied from here — and ending it,
 * which DEC-163 leaves to a person.
 *
 * The confirm step uses the paid pane's two buttons — **Cancel this booking** and **Do Not Cancel**
 * — so ending a booking reads the same whichever state it is in.
 */

/** The route's state for these actions, from the query string. */
export interface UnpaidActionState {
  /** The grid's day and filter, carried through the cancel so Back returns to the same view. */
  date: string;
  filter: string;
  /** `list` when the calendar behind the pane is the List (issue #1079). */
  view: string;
  /** The render right after the operator booked this by phone. */
  justBooked: boolean;
  confirmingCancel: boolean;
  cancelHref: string;
  backHref: string;
  cancelErr?: string | undefined;
  /** The last payment-link send, per channel (`payment-link-message.ts`). At booking it rides in the
   *  just-booked note; after Send payment link it shows here. */
  linkSent?: string | undefined;
  /** A freshly signed link for Copy payment link, or absent when this deploy can't build one. */
  payLinkUrl?: string | undefined;
  /** Something is owed (`payLinkState`). False on a $0 comp whose confirm failed (DEC-194) — no
   *  payment-link controls then, only Cancel. */
  payable: boolean;
  /** The contact the link goes to, for naming it in the send outcome. */
  phone?: string | undefined;
  email?: string | undefined;
}

const CANCEL_ERR_COPY: Record<PhoneCancelErr, string> = {
  now_booked:
    "The customer just paid — this is a booking now, so it wasn’t cancelled. Reload to see it; cancel it from there if you still mean to, with its refund.",
  not_booked: "This booking can’t be cancelled from here.",
  not_muster: "This booking can’t be cancelled from here.",
  reservation_missing: "That booking no longer exists.",
  unreachable: "Couldn’t cancel just now — nothing changed. Try again in a moment.",
};

export function PhoneBookingActions({
  reservationId,
  cancelled,
  state,
}: {
  reservationId: string;
  cancelled: boolean;
  state: UnpaidActionState;
}) {
  const error = errCopyFor(CANCEL_ERR_COPY, state.cancelErr, "unreachable");
  if (cancelled && !error) return null;
  // At booking the outcome is in the just-booked note; here it answers a Send payment link press.
  const sent =
    state.linkSent !== undefined && !state.justBooked
      ? paymentLinkSentMessage(state.linkSent, { phone: state.phone, email: state.email })
      : null;

  return (
    // The anchor the cancel's redirect lands on, same as the paid pane's actions.
    <div id="booking-actions" className="flex scroll-mt-4 flex-col gap-2" data-testid="reservation-actions">
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {sent ? <Notice tone={sent.tone}>{sent.text}</Notice> : null}
      {cancelled || !state.payable ? null : <PaymentLinkControls reservationId={reservationId} state={state} />}
      {cancelled ? null : <CancelControl reservationId={reservationId} state={state} />}
    </div>
  );
}

/**
 * Send payment link (filled) texts and emails a fresh one; Copy payment link (outlined) puts one on
 * the clipboard in the one press — a button with those words must copy, not reveal (operator,
 * 2026-09-29). The link also shows on a line under it, to read out on the phone. The pane signs a
 * fresh one each render: signing stores nothing, so there is no "the" link, only one good for the
 * next 72 hours.
 */
function PaymentLinkControls({ reservationId, state }: { reservationId: string; state: UnpaidActionState }) {
  return (
    <div className="flex flex-col gap-2" data-testid="payment-link-controls">
      <form action={sendPaymentLinkAgain}>
        <input type="hidden" name="reservationId" value={reservationId} />
        <input type="hidden" name="date" value={state.date} />
        <input type="hidden" name="filter" value={state.filter} />
        <input type="hidden" name="view" value={state.view} />
        <SubmitButton className="btn-primary min-h-[44px] w-full">Send payment link</SubmitButton>
      </form>
      {state.payLinkUrl ? (
        <>
          <CopyButton value={state.payLinkUrl} label="Copy payment link" className="btn-secondary min-h-[44px] w-full" />
          <span className="select-all break-all font-mono text-[11px] text-muted" data-testid="pay-link">
            {state.payLinkUrl}
          </span>
        </>
      ) : null}
      <p className="text-xs text-muted">The link works for {PAYMENT_LINK_HOURS} hours.</p>
    </div>
  );
}

function CancelControl({ reservationId, state }: { reservationId: string; state: UnpaidActionState }) {
  if (!state.confirmingCancel) {
    return (
      <AppLink href={state.cancelHref} data-testid="cancel-start" className="btn-secondary flex min-h-[44px]">
        Cancel booking…
      </AppLink>
    );
  }
  return (
    <form action={cancelPhoneBooking} className="flex flex-col gap-2" data-testid="cancel-confirm">
      <input type="hidden" name="reservationId" value={reservationId} />
      <input type="hidden" name="date" value={state.date} />
      <input type="hidden" name="filter" value={state.filter} />
      <input type="hidden" name="view" value={state.view} />
      <p className="text-sm font-medium text-ink">Cancel this booking and free the boat?</p>
      <p className="text-xs text-muted">Nothing was paid, so nothing is refunded.</p>
      <fieldset>
        <legend className="sr-only">Why</legend>
        {(
          [
            ["customer", "The customer didn’t pay, or changed their mind"],
            ["operator", "We cancelled"],
          ] as const
        ).map(([value, label]) => (
          <Radio
            key={value}
            name="by"
            value={value}
            defaultChecked={value === "customer"}
            className="border-b border-line last:border-0"
          >
            {label}
          </Radio>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <SubmitButton data-commits="cancel" className="btn-danger min-h-[44px] flex-1">
          Cancel this booking
        </SubmitButton>
        <AppLink href={state.backHref} className="btn-secondary min-h-[44px]">
          Do Not Cancel
        </AppLink>
      </div>
    </form>
  );
}
