"use server";

import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { confirmCompedBooking } from "@core/reservations/confirm-booking.js";
import { parseDollarsToCents } from "@core/reservations/dollars.js";
import { bookForCustomer, type OperatorBookingResult } from "@core/reservations/operator-booking.js";
import { readSubject } from "../../../lib/auth";
import { completionDeps } from "../../../lib/booking-deps";
import { clearFormDraft, stashFormDraft } from "../../../lib/form-draft";
import { deliverPaymentLink } from "../../../lib/payment-link";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";

/**
 * Every code this surface can put in `?err=` — the write's refusals plus the glue's own. Consumed
 * by the page's copy table, so a new refusal with nothing to say is a build error.
 */
export type BookErr = Extract<OperatorBookingResult, { ok: false }>["reason"] | "unreachable";

/**
 * The form lives in the calendar's pane (issue #1104 part 3), so its draft cookie is scoped to the
 * calendar (`form-draft.ts`). The reservation pane's refund draft shares that cookie; each reader
 * checks the draft is its own (this one by boat, day and time; that one by reservation id).
 */
const SURFACE = "/admin/calendar";

/**
 * The operator books (16.1, SPEC §2.10.6). Auth + FormData glue over `bookForCustomer`, which
 * owns every rule. `redirect()` throws, so it lives outside the try (house convention).
 *
 * On success the payment link is texted and emailed to the customer, and the operator lands on the
 * booking's own pane — which says where the link went, resends or copies it, and cancels the unpaid
 * booking.
 */
export async function bookPhoneReservation(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  const field = (k: string) => String(formData.get(k) ?? "").trim();
  const date = field("date");
  const time = field("time");
  const vesselId = field("vesselId");
  const offeringId = field("offeringId");
  // The discount box (16.5, DEC-194): blank is none, anything else must parse as dollars exactly as
  // the refund box does. A value that doesn't parse goes in as NaN so the write refuses it by name
  // (`invalid_discount`) rather than this glue inventing a second refusal path.
  const discountRaw = field("discount");
  const discountCents = discountRaw === "" ? 0 : (parseDollarsToCents(discountRaw) ?? Number.NaN);

  let result: OperatorBookingResult | null = null;
  try {
    result = await bookForCustomer(
      getRepo(),
      {
        offeringId: asId<"OfferingId">(offeringId),
        vesselId: asId<"VesselId">(vesselId),
        date,
        time,
        guestCount: Number(field("guests")),
        gratuityBps: Number(field("gratuityBps")),
        customerName: field("customerName"),
        phone: field("phone"),
        ...(field("email") ? { email: field("email") } : {}),
        discountCents,
        // The insurance box (16.8) posts "1" when ticked and nothing when not.
        hasFlex: field("hasFlex") === "1",
      },
      () => new Date().toISOString(),
    );
  } catch (e) {
    logSwallowed("admin/calendar:bookPhoneReservation", e, "the phone booking was not written");
  }

  if (result?.ok && result.reservation.invoice?.amountDueNowCents === 0) {
    await clearFormDraft(SURFACE);
    // A COMP (DEC-194): nothing to pay, so no payment link — it confirms here and now through
    // §2.8.6's comp confirm, which forms the shift and sends the customer their confirmation.
    // Best-effort like the link: the booking is written either way, and a comp that failed to
    // confirm is said on the pane rather than passed off as booked.
    let comped = "error";
    try {
      const outcome = await confirmCompedBooking(completionDeps(), result.reservation.id);
      if (outcome !== "unconfirmable") comped = "1";
    } catch (e) {
      logSwallowed("admin/calendar:bookPhoneReservation", e, "the comp was written but did not confirm");
    }
    const q = new URLSearchParams({ date, comped });
    if (field("view") === "list") q.set("view", "list");
    redirect(`/admin/calendar/${encodeURIComponent(String(result.reservation.id))}?${q.toString()}`);
  }

  if (result?.ok) {
    await clearFormDraft(SURFACE);
    // The payment link goes out as soon as the booking exists (issue #1082 part B) — the customer
    // is usually still on the phone, so the pane says which channels reached them. Best-effort: the
    // booking is written either way, and a send that threw reads as `error`, never as sent.
    let linkSent = "error";
    try {
      const outcome = await deliverPaymentLink(result.reservation, { kind: "admin", id: subject.id });
      linkSent = outcome.kind === "skipped" ? "skipped" : `${outcome.result.email}-${outcome.result.sms}`;
    } catch (e) {
      logSwallowed("admin/calendar:bookPhoneReservation", e, "the payment link was not sent — the booking stands");
    }
    const q = new URLSearchParams({ date, booked: "1", linkSent });
    if (field("view") === "list") q.set("view", "list");
    redirect(`/admin/calendar/${encodeURIComponent(String(result.reservation.id))}?${q.toString()}`);
  }

  // Nothing was written, so the form comes back with what the operator typed — a caller is on
  // the line, and retyping their details is the thing not to make them wait through. It comes back
  // in the same pane: the slot (`hold`) and `book=1` reopen it, and `guests` (16.1d) selects the
  // checkout step the refusal is shown on. `bookErr`, not `err`: the calendar's `err` is the
  // block/unblock banner's.
  await stashFormDraft(SURFACE, formData);
  const q = new URLSearchParams({
    date,
    hold: `${vesselId}|${time}`,
    book: "1",
    bookErr: result ? result.reason : "unreachable",
  });
  if (offeringId) q.set("offering", offeringId);
  if (field("guests")) q.set("guests", field("guests"));
  if (field("view") === "list") q.set("view", "list");
  redirect(`${SURFACE}?${q.toString()}`);
}
