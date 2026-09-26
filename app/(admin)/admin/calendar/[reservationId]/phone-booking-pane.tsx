import type { Reservation } from "@core/domain/entities.js";
import { AppLink } from "../../../../../components/ui/app-link";
import { Notice } from "../../../../../components/ui/notice";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { errCopyFor } from "../../../../lib/err-copy";
import { clockTime, formatFullDay } from "../calendar-view";
import { cancelPhoneBooking, type PhoneCancelErr } from "./actions";

/**
 * The pane for an operator's phone booking that has not been paid (16.1, §2.10.6, DEC-163).
 *
 * **Its own pane, not a branch of `ReservationDetailPane`.** That one is built around an Event —
 * money received, tips, crew, refund — and a phone booking has none of those until it is paid:
 * no Event exists before confirm (§2.8.2). Once paid the row turns `muster`, gains its Event, and
 * renders in the ordinary pane like any other booking. So this pane only ever shows two states:
 * awaiting payment, and cancelled without ever having been paid.
 *
 * What it can do is the one thing DEC-163 leaves to a person: end it. The payment link the
 * customer pays through lands here next (16.1a).
 */

const CANCEL_ERR_COPY: Record<PhoneCancelErr, string> = {
  now_booked:
    "The customer just paid — this is a booking now, so it wasn’t cancelled. Reload to see it; cancel it from there if you still mean to, with its refund.",
  not_booked: "This booking can’t be cancelled from here.",
  not_muster: "This booking can’t be cancelled from here.",
  reservation_missing: "That booking no longer exists.",
  unreachable: "Couldn’t cancel just now — nothing changed. Try again in a moment.",
};

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PhoneBookingPane({
  reservation,
  vesselName,
  offeringName,
  date,
  filter,
  justBooked,
  confirmingCancel,
  cancelHref,
  backHref,
  cancelErr,
}: {
  reservation: Reservation;
  vesselName: string;
  offeringName?: string | undefined;
  /** The grid's day and filter, carried through the cancel so Back returns to the same view. */
  date: string;
  filter: string;
  justBooked: boolean;
  confirmingCancel: boolean;
  cancelHref: string;
  backHref: string;
  cancelErr?: string | undefined;
}) {
  const cancelled = reservation.status === "cancelled";
  const error = errCopyFor(CANCEL_ERR_COPY, cancelErr, "unreachable");
  const invoice = reservation.invoice;

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span
          data-testid="phone-booking-state"
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
            cancelled ? "border-line text-muted" : "border-warn-line bg-warn-bg text-warn"
          }`}
        >
          {cancelled ? "Cancelled — never paid" : "Awaiting payment"}
        </span>
        <span className="text-xs text-muted">Booked by phone</span>
      </div>

      {justBooked && !cancelled ? (
        <Notice tone="ok">
          Booked. The boat is held for {reservation.customerName} until they pay or you cancel it —
          it doesn’t expire on its own.
        </Notice>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Departure</dt>
        <dd className="text-ink">
          {reservation.date ? formatFullDay(reservation.date) : "—"}
          {reservation.time ? `, ${clockTime(reservation.time)}` : ""}
        </dd>
        <dt className="text-muted">Boat</dt>
        <dd className="text-ink">{vesselName}</dd>
        {offeringName ? (
          <>
            <dt className="text-muted">Cruise</dt>
            <dd className="text-ink">{offeringName}</dd>
          </>
        ) : null}
        <dt className="text-muted">Guests</dt>
        <dd className="text-ink">{reservation.partySize}</dd>
        <dt className="text-muted">Mobile</dt>
        <dd className="text-ink">{reservation.phone ?? "—"}</dd>
        {reservation.email ? (
          <>
            <dt className="text-muted">Email</dt>
            <dd className="break-all text-ink">{reservation.email}</dd>
          </>
        ) : null}
        {invoice ? (
          <>
            <dt className="text-muted">{cancelled ? "Was quoted" : "Owes"}</dt>
            <dd className="font-medium text-ink">{dollars(invoice.amountDueNowCents)}</dd>
          </>
        ) : null}
      </dl>

      {cancelled ? null : (
        <div id="booking-actions" className="border-t border-line pt-3">
          {confirmingCancel ? (
            <form action={cancelPhoneBooking} className="flex flex-col gap-2">
              <input type="hidden" name="reservationId" value={String(reservation.id)} />
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="filter" value={filter} />
              <p className="text-sm font-medium text-ink">Cancel this booking and free the boat?</p>
              <p className="text-xs text-muted">Nothing was paid, so nothing is refunded.</p>
              <fieldset className="flex flex-col gap-1 text-sm text-ink">
                <legend className="sr-only">Why</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="by" value="customer" defaultChecked />
                  The customer didn’t pay, or changed their mind
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="by" value="operator" />
                  We cancelled
                </label>
              </fieldset>
              <div className="flex items-center gap-3">
                <AppLink href={backHref} className="text-sm text-muted">
                  Keep it
                </AppLink>
                <SubmitButton className="btn-danger">
                  Cancel booking
                </SubmitButton>
              </div>
            </form>
          ) : (
            <AppLink href={cancelHref} data-testid="phone-booking-cancel" className="btn-quiet text-sm text-bad">
              Cancel booking…
            </AppLink>
          )}
        </div>
      )}
    </div>
  );
}
