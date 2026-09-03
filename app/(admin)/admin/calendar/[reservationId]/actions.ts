"use server";

import { redirect } from "next/navigation";
import { StripePaymentPort } from "@core/adapters/stripe-payment.js";
import { asId } from "@core/domain/ids.js";
import { createBalanceCheckout } from "@core/reservations/create-balance-checkout.js";
import {
  cancelReservation,
  quoteCancelRefund,
  type CancelledBy,
} from "@core/reservations/cancel-reservation.js";
import { zonedWallClockToInstant } from "@core/config/tenant.js";
import {
  parseDollarsToCents,
  refundableTotalFor,
  refundReservation,
} from "@core/reservations/refund-payment.js";
import type { Reservation } from "@core/domain/entities.js";
import { forwardFormNotices } from "../../../../lib/channel";
import { reissueBookingCode } from "@core/reservations/ensure-booking-code.js";
import { resendReservationLink } from "../../../../lib/booking-confirmation";
import { readSubject } from "../../../../lib/auth";
import { clearFormDraft, stashFormDraft } from "../../../../lib/form-draft";
import { getRepo } from "../../../../lib/repo";
import { logSwallowed } from "../../../../lib/swallowed";

/**
 * Mint a BALANCE LINK for a deposit booking (11.2b, DEC-107) — the operator door for a
 * service that shipped tested and callable but with no caller outside `db:balance`.
 *
 * The operator sends the link; the CUSTOMER pays. Muster writes nothing here — the
 * `Payment{kind:'balance'}` lands via the Stripe webhook (`metadata.purpose="balance"`), so a
 * minted-but-unpaid link is inert and re-minting is free. That is why this can be a plain
 * button with no confirmation: it charges nobody and changes no state.
 *
 * The URL comes back on the query string rather than being stored: the link is **re-minted per
 * request against the CURRENT balance** (`createBalanceCheckout` derives the amount through
 * `balanceOwedCents`), so persisting one would be persisting a number that goes stale the moment
 * a payment lands. Query-string round-trip keeps the page server-rendered with no client JS.
 *
 * Deliberately NOT emailed/texted to the customer: customer messaging needs the second sender
 * number (#119) so a customer can never reach the crew line. Operator copies and sends.
 */
/** Back to a reservation's detail, preserving the grid's day/filter. */
function detailHref(
  reservationId: string,
  date: string,
  filter: string,
  extra: Record<string, string>,
): string {
  const p = new URLSearchParams();
  if (date) p.set("date", date);
  if (filter) p.set("filter", filter);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const q = p.toString();
  // `#booking-actions` so a server action's redirect lands you back at the controls rather than
  // at the top of the page. A `redirect()` is a full navigation and `AppLink`'s `scroll={false}`
  // cannot reach it; the fragment can, with no JS. Every action on this pane redirects, so
  // without it each press costs a scroll back down (operator, 2026-08-10).
  return `/admin/calendar/${encodeURIComponent(reservationId)}${q ? `?${q}` : ""}#booking-actions`;
}

/** The three fields every action on this pane posts back. */
function readContext(formData: FormData): {
  reservationId: string;
  date: string;
  filter: string;
  back: (extra: Record<string, string>) => string;
} {
  const reservationId = String(formData.get("reservationId") ?? "");
  const date = String(formData.get("date") ?? "");
  const filter = String(formData.get("filter") ?? "");
  return {
    reservationId,
    date,
    filter,
    back: (extra) => detailHref(reservationId, date, filter, extra),
  };
}

export async function createBalanceLink(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const { reservationId, back } = readContext(formData);

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) redirect(back({ balanceErr: "stripe_not_configured" }));

  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

  let result: Awaited<ReturnType<typeof createBalanceCheckout>>;
  try {
    result = await createBalanceCheckout(
      getRepo(),
      new StripePaymentPort(secretKey, webhookSecret),
      asId<"ReservationId">(reservationId),
      { successUrl: `${base}/book/success`, cancelUrl: `${base}/book/cancel` },
    );
  } catch (e) {
    // Stripe unreachable / key rejected — say so rather than showing a dead button.
    // Money path. "stripe_unreachable" is a guess about the cause: a rejected key,
    // an expired one, and a genuine network failure all land here identically, and
    // only the first two are actionable.
    logSwallowed("admin/reservation:createBalanceLink", e, "the balance checkout session was not created");
    redirect(back({ balanceErr: "stripe_unreachable" }));
  }

  if (!result.ok) redirect(back({ balanceErr: result.reason }));
  redirect(back({ balanceUrl: result.url }));
}

/**
 * Cancel the booking (#616) — the operator action that did not exist anywhere in the product.
 *
 * Writes the reservation AND its event to `cancelled`, which is what actually frees the boat:
 * the reservation releases this slot for re-sale, the event releases every neighbouring
 * departure on that hull and collapses the crew shift. See `cancelReservation` for why both.
 *
 * **Moves no money.** The confirm screen quotes what the published terms produce and the
 * operator refunds separately, with a figure they can edit — cancelling and refunding are
 * different decisions and one press should not make both.
 */
export async function cancelBooking(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const { reservationId, back } = readContext(formData);
  const by: CancelledBy = formData.get("by") === "operator" ? "operator" : "customer";

  let result: Awaited<ReturnType<typeof cancelReservation>>;
  try {
    // `by` is what the confirm asked and what the refund branched on; since #724 it is also
    // recorded on the reservation rather than surviving only as a refund figure.
    result = await cancelReservation(
      {
        repo: getRepo(),
        now: () => new Date().toISOString(),
        // A cancel collapses the shift, and the crew on it have to be TOLD (DEC-084/#244).
        // This is the notice that matters most in the whole product: without it a confirmed
        // crew member drives to a boat that is not sailing.
        relayFormNotices: forwardFormNotices,
      },
      asId<"ReservationId">(reservationId),
      by,
    );
  } catch (e) {
    // The comment three lines up calls the crew notice "the notice that matters
    // most in the whole product: without it a confirmed crew member drives to a
    // boat that is not sailing." A throw here may land anywhere in that sequence.
    logSwallowed("admin/reservation:cancelBooking", e, "the cancel did not complete — crew may or may not have been told");
    await stashFormDraft("/admin/calendar", formData);
    redirect(back({ cancelErr: "unreachable" }));
  }

  if (!result.ok) {
    // Nothing was cancelled, so the confirm screen comes back — with `by` reset to its first
    // option, which is a different refund quote than the one the operator picked.
    await stashFormDraft("/admin/calendar", formData);
    redirect(back({ cancelErr: result.reason }));
  }

  // ── and refund, in the same press (operator, 2026-08-10) ────────────────────
  //
  // Cancelling and refunding were two separate presses, and the figures on the confirm screen
  // therefore belonged to a decision made somewhere else — "they don't really mean anything
  // here". They mean something now: this is the press that spends them.
  //
  // **The amount is computed HERE when the box is blank**, from the reason actually posted. That
  // is not a convenience, it is the correctness argument for the whole design: with no client JS
  // a prefilled box cannot follow the radio, so a prefill would let "We cancelled" refund at the
  // customer rate whenever the operator didn't retype. A blank box has no wrong value to carry.
  //
  // Ordering is deliberate: the cancellation is already committed above and is NOT rolled back if
  // the refund fails. Freeing the boat and telling the crew is the urgent half and it is correct
  // on its own; money that did not move can be moved on the next press, from a page that now
  // shows what is still owed. The reverse — refunding and then failing to cancel — would leave a
  // refunded customer holding a boat.
  const typed = String(formData.get("amount") ?? "").trim();
  let refundCents: number | null = null;
  if (typed === "") {
    const payments = await getRepo().listPaymentsForReservation(asId<"ReservationId">(reservationId));
    const event = result.freedEventId
      ? await getRepo().getEvent(result.freedEventId)
      : null;
    // No event ⇒ no departure instant ⇒ no notice window, so the published-terms figure cannot
    // be derived. Cancel stands; the operator refunds by hand from the box.
    if (event) {
      refundCents = quoteCancelRefund({
        by,
        payments,
        departureAt: zonedWallClockToInstant(event.date, event.time),
        now: new Date(),
      }).refundCents;
    }
  } else {
    const parsed = parseDollarsToCents(typed);
    // The cancel HAPPENED. A bad amount cannot undo it, so this reports the cancel as done and
    // the refund as not attempted — never a bare `invalid_amount` that reads like nothing ran.
    if (parsed === null) {
      // The cancel already COMMITTED, so the confirm screen this was typed on is gone — the
      // figure has to survive into the standalone refund box or it is lost. That box prefills,
      // so losing it shows a plausible WRONG number rather than an empty field (#780).
      await stashFormDraft("/admin/calendar", formData);
      redirect(back({ cancelled: by, refundErr: "invalid_amount" }));
    }
    refundCents = parsed;
  }

  // Zero is a legitimate outcome, not a failure: inside the 14-day window the published terms owe
  // nothing, and the operator can type 0 to cancel without refunding.
  if (refundCents === null || refundCents <= 0) {
    await clearFormDraft("/admin/calendar");
    redirect(back({ cancelled: by }));
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    await stashFormDraft("/admin/calendar", formData);
    redirect(back({ cancelled: by, refundErr: "stripe_not_configured" }));
  }
  const expectedRaw = String(formData.get("expectedRefunded") ?? "");
  if (!/^\d+$/.test(expectedRaw)) {
    await stashFormDraft("/admin/calendar", formData);
    redirect(back({ cancelled: by, refundErr: "stale" }));
  }

  let refund: Awaited<ReturnType<typeof refundReservation>>;
  try {
    refund = await refundReservation(
      {
        repo: getRepo(),
        payments: new StripePaymentPort(secretKey, webhookSecret),
        now: () => new Date().toISOString(),
      },
      asId<"ReservationId">(reservationId),
      refundCents,
      Number(expectedRaw),
    );
  } catch (e) {
    // Money path, and the ambiguous half: the booking may already be cancelled
    // while the refund is not, which is exactly what `cancelled: by` in the
    // redirect is admitting.
    logSwallowed("admin/reservation:cancelBooking", e, "the refund leg of cancel-and-refund did not complete");
    redirect(back({ cancelled: by, refundErr: "unreachable" }));
  }

  if (!refund.ok) {
    if (refund.reason === "provider_error") {
      console.error(
        `[reservations] cancel+refund of ${refundCents}c on ${reservationId} failed partway ` +
          `(${refund.refundedCents}c did move): ${refund.message}`,
      );
      // CLEAR, not stash — the opposite of every other refusal here, and deliberately (#780).
      // Money PARTIALLY moved. Re-offering the figure the operator typed is the one thing this
      // screen's own copy tells them not to do ("retrying the full amount would refund that
      // {moved} twice"). Dropping the draft falls the box back to the recomputed refundable,
      // which already accounts for what went through.
      await clearFormDraft("/admin/calendar");
      redirect(
        back({ cancelled: by, refundErr: "provider_error", refunded: String(refund.refundedCents) }),
      );
    }
    // Nothing moved on these (`no_payment_intent`, `not_muster`, …), so the operator's figure
    // still stands and is worth keeping.
    await stashFormDraft("/admin/calendar", formData);
    redirect(back({ cancelled: by, refundErr: refund.reason }));
  }
  await clearFormDraft("/admin/calendar");
  redirect(back({ cancelled: by, refunded: String(refund.refundedCents) }));
}

/**
 * Refund some or all of what the customer paid (#616).
 *
 * The operator types one dollar figure; `refundReservation` splits it across the booking's
 * charges because Stripe refunds a PaymentIntent, not a booking. `expectedRefunded` is the
 * refunded total the screen was rendered against — a compare-and-swap that makes a
 * double-submit (or a no-JS double post) refuse rather than refund twice.
 */
/**
 * Step ONE of a refund: validate the typed amount and open the confirm screen (#616).
 *
 * Refunding is the one action here that moves real money in a single press, and unlike
 * cancelling it cannot be inferred from the surrounding state afterwards — a wrong amount looks
 * exactly like a right one. So it gets the same two-step the cancel has, and the validation runs
 * HERE rather than on the confirm screen: being told "that isn't a valid amount" after
 * confirming is being asked to confirm something the system had already rejected.
 *
 * Writes nothing and calls no provider, so it needs no confirmation of its own.
 */
export async function startRefund(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const { reservationId, back } = readContext(formData);

  const amountCents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  if (amountCents === null || amountCents <= 0) {
    // The box `defaultValue`s to a server-computed prefill, so losing the typed figure doesn't
    // come back empty — it comes back holding a DIFFERENT, plausible number (#780). On a money
    // field that is the worst shape of wrong, because it looks filled in.
    await stashFormDraft("/admin/calendar", formData);
    redirect(back({ refundErr: "invalid_amount" }));
  }
  // Re-derive the ceiling server-side rather than trusting the form's own cap — the box is a
  // text input and the posted value is whatever the client sent. `refundReservation` would
  // refuse an over-ask anyway; catching it before the confirm screen means the operator is
  // never asked to confirm an amount that cannot go through.
  const payments = await getRepo().listPaymentsForReservation(
    asId<"ReservationId">(reservationId),
  );
  if (amountCents > refundableTotalFor(payments)) {
    await stashFormDraft("/admin/calendar", formData);
    redirect(back({ refundErr: "exceeds_refundable" }));
  }
  // Step one succeeded; the amount now rides the URL to the confirm screen and the draft is spent.
  await clearFormDraft("/admin/calendar");
  redirect(back({ refundConfirm: String(amountCents) }));
}

export async function refundBooking(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const { reservationId, back } = readContext(formData);

  const amountCents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  if (amountCents === null) redirect(back({ refundErr: "invalid_amount" }));

  // The CAS token. A missing or non-numeric value is a malformed post, not a zero — treating
  // it as zero would silently disarm the double-submit guard on the one path that needs it.
  const expectedRaw = String(formData.get("expectedRefunded") ?? "");
  if (!/^\d+$/.test(expectedRaw)) redirect(back({ refundErr: "stale" }));

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) redirect(back({ refundErr: "stripe_not_configured" }));

  let result: Awaited<ReturnType<typeof refundReservation>>;
  try {
    result = await refundReservation(
      {
        repo: getRepo(),
        payments: new StripePaymentPort(secretKey, webhookSecret),
        now: () => new Date().toISOString(),
      },
      asId<"ReservationId">(reservationId),
      amountCents,
      Number(expectedRaw),
    );
  } catch (e) {
    // Reaching here means the call threw OUTSIDE the provider loop (the loop returns
    // `provider_error` rather than throwing), so no refund was issued.
    logSwallowed("admin/reservation:refundBooking", e, "no refund was issued");
    redirect(back({ refundErr: "unreachable" }));
  }

  if (!result.ok) {
    // A partial failure still moved money. Say how much, so the operator's next decision is
    // made against what actually happened rather than against the amount they asked for.
    if (result.reason === "provider_error") {
      // Log the provider's own message. The operator gets generic copy by design (a raw Stripe
      // string in the UI is both unhelpful and an exposure question), but discarding it
      // entirely left a production refund failure with NO record anywhere in Muster of why —
      // nothing to correlate against Stripe's dashboard. Security review.
      console.error(
        `[reservations] refund of ${amountCents}c on ${reservationId} failed partway ` +
          `(${result.refundedCents}c did move): ${result.message}`,
      );
      redirect(back({ refundErr: "provider_error", refunded: String(result.refundedCents) }));
    }
    redirect(back({ refundErr: result.reason }));
  }
  redirect(back({ refunded: String(result.refundedCents) }));
}

/**
 * Re-send the booking confirmation + manage link (#616).
 *
 * `booking-confirmation.ts:37` has described this path since 11.4 ("a durable log / admin
 * notice so the operator can resend") and there was no way to do it.
 *
 * The precondition worth checking here is the one that actually fails: a reservation with
 * neither an email nor a phone has nowhere to send.
 *
 * **It reports per channel (#686).** It used to redirect `resent=1` whatever happened, because
 * the confirmation emitter returns `void` — right inside the Stripe webhook, where nobody is
 * watching and a throw makes Stripe retry the event, but wrong behind a button. An email-only
 * booking, a Twilio outage and a two-channel success all rendered as the same green "Sent".
 * `resendReservationLink` hands the outcome back and the pair travels as a code.
 *
 * "Sent" still means handed to the medium, not delivered — Resend accepting an email is not the
 * customer receiving it. What it no longer means is "we tried nothing and called it success".
 */
export async function resendConfirmation(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const { reservationId, back } = readContext(formData);

  let reservation: Reservation | null;
  try {
    reservation = await getRepo().getReservation(asId<"ReservationId">(reservationId));
  } catch (e) {
    logSwallowed("admin/reservation:resendConfirmation", e, "the reservation could not be read");
    redirect(back({ resendErr: "unreachable" }));
  }
  if (!reservation) redirect(back({ resendErr: "reservation_missing" }));
  // The manage link is Muster-side only (DEC-122) — a Xola booking has no capability URL.
  if (reservation.source !== "muster") redirect(back({ resendErr: "not_muster" }));
  if (!reservation.email && !reservation.phone) redirect(back({ resendErr: "no_contact" }));
  // A cancelled booking must not be re-confirmed. The body says the trip is booked and carries a
  // live manage link; sending it after a cancellation tells the customer the opposite of what
  // just happened, in writing. Security review.
  if (reservation.status !== "booked") redirect(back({ resendErr: "cancelled" }));

  // Wrapped like every other core call in this file (`createBalanceCheckout`, `cancelReservation`,
  // `refundReservation`). `resendReservationLink` builds its own channels and calls `getRepo()`
  // again, and unlike `sendReservationConfirmation` — which wraps its whole body because the
  // webhook cannot tolerate a throw — it deliberately does not swallow. So a pool hiccup here
  // would escape a server action instead of landing on the `unreachable` copy that already exists
  // three times over on this page.
  let outcome: Awaited<ReturnType<typeof resendReservationLink>>;
  try {
    outcome = await resendReservationLink(reservation);
  } catch (e) {
    // The comment above notes this path "deliberately does not swallow" upstream,
    // so a throw reaching here is the pool hiccup that block anticipated.
    logSwallowed("admin/reservation:resendConfirmation", e, "the confirmation was not re-sent");
    redirect(back({ resendErr: "unreachable" }));
  }
  // Codes only on the query string, never prose (DEC-147, not DEC-026 — see that DEC's own
  // banner about ~34 comments mis-citing it). The page maps them to copy. The
  // pair is what makes the message truthful: `sent-absent` is an email-only booking, which the
  // old flat `resent=1` reported identically to a successful two-channel send.
  if (outcome.kind === "skipped") redirect(back({ resendErr: outcome.reason }));
  const { email, sms } = outcome.result;
  // NOTHING out is never a success, and the two ways to get there are different facts.
  //
  // `failed` is a medium that rejected it; `absent` is a contact this deployment has no channel
  // for — a booking with only a phone on a deployment with only email configured sends nothing
  // at all, and the first cut of this reported it as "Link sent again." The e2e caught it: the
  // suite blanks Twilio, and the seed booking is phone-only, so that lie was on screen the first
  // time the test ran.
  if (email !== "sent" && sms !== "sent") {
    redirect(back({ resendErr: email === "failed" || sms === "failed" ? "all_failed" : "nothing_sent" }));
  }
  redirect(back({ resent: `${email}-${sms}` }));
}

/**
 * Mint a NEW booking code, kill the old one, and send the new link to the customer (#741).
 *
 * The difference from `resendConfirmation` is the whole point and is worth stating where an
 * operator's finger is: a **resend** puts the same link back in the customer's inbox; a
 * **reissue** makes their existing link stop working. It is the control for a link that leaked,
 * a phone that was lost, or a booking forwarded to the wrong person — and it is destructive in a
 * way a resend never is, which is why the pane asks for a confirm.
 *
 * Guards are `resendConfirmation`'s, for the same reasons, plus one consequence of ordering:
 * the reissue happens FIRST and the send second, so a send failure leaves the customer holding a
 * dead link. That is the correct trade — the operator reached for this because the OLD link had
 * to die — but it means a failed send here is worse than a failed resend, and the copy says so.
 */
export async function reissueBookingLink(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const { reservationId, back } = readContext(formData);

  let reservation: Reservation | null;
  try {
    reservation = await getRepo().getReservation(asId<"ReservationId">(reservationId));
  } catch (e) {
    logSwallowed("admin/reservation:reissueBookingLink", e, "the reservation could not be read");
    redirect(back({ reissueErr: "unreachable" }));
  }
  if (!reservation) redirect(back({ reissueErr: "reservation_missing" }));
  if (reservation.source !== "muster") redirect(back({ reissueErr: "not_muster" }));
  if (!reservation.email && !reservation.phone) redirect(back({ reissueErr: "no_contact" }));
  if (reservation.status !== "booked") redirect(back({ reissueErr: "cancelled" }));

  let reissue: Awaited<ReturnType<typeof reissueBookingCode>>;
  try {
    reissue = await reissueBookingCode(getRepo(), reservation.id, () => new Date().toISOString());
  } catch (e) {
    // A throw means the MINT failed — `reissueBookingCode` never raises past that point — so
    // nothing was revoked and the customer's existing link still works.
    logSwallowed("admin/reservation:reissueBookingLink", e, "no new booking code was minted — the old link still works");
    redirect(back({ reissueErr: "unreachable" }));
  }

  // Picks up the code just minted (it is now the live one).
  let outcome: Awaited<ReturnType<typeof resendReservationLink>>;
  try {
    outcome = await resendReservationLink(reservation);
  } catch (e) {
    // The dangerous ordering: the mint above SUCCEEDED, so the customer's old link
    // is already revoked, and this failure means the new one never reached them.
    // They are locked out of their own booking and the operator sees only
    // "sent_nothing".
    logSwallowed("admin/reservation:reissueBookingLink", e, "the NEW link was not sent, and the old one is already revoked");
    redirect(back({ reissueErr: "sent_nothing" }));
  }
  if (outcome.kind === "skipped") redirect(back({ reissueErr: "sent_nothing" }));
  const { email: e2, sms: s2 } = outcome.result;
  if (e2 !== "sent" && s2 !== "sent") redirect(back({ reissueErr: "sent_nothing" }));
  // The new link went out, but an old one survived the revoke — so the operator must NOT be told
  // the previous link is dead, which is the whole reason they pressed this.
  if (reissue.staleCodes.length > 0) redirect(back({ reissueErr: "old_link_alive" }));
  redirect(back({ reissued: `${e2}-${s2}` }));
}
