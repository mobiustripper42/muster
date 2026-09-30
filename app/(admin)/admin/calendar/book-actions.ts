"use server";

import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { bookForCustomer, type OperatorBookingResult } from "@core/reservations/operator-booking.js";
import { readSubject } from "../../../lib/auth";
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
      },
      () => new Date().toISOString(),
    );
  } catch (e) {
    logSwallowed("admin/calendar:bookPhoneReservation", e, "the phone booking was not written");
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
  redirect(`${SURFACE}?${q.toString()}`);
}
