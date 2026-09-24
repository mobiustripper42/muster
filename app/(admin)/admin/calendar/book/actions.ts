"use server";

import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { bookForCustomer, type OperatorBookingResult } from "@core/reservations/operator-booking.js";
import { readSubject } from "../../../../lib/auth";
import { clearFormDraft, stashFormDraft } from "../../../../lib/form-draft";
import { getRepo } from "../../../../lib/repo";
import { logSwallowed } from "../../../../lib/swallowed";

/**
 * Every code this surface can put in `?err=` — the write's refusals plus the glue's own. Consumed
 * by the page's copy table, so a new refusal with nothing to say is a build error.
 */
export type BookErr = Extract<OperatorBookingResult, { ok: false }>["reason"] | "unreachable";

/** The form lives here, so its draft cookie is scoped here (`form-draft.ts`). */
const SURFACE = "/admin/calendar/book";

/**
 * The operator books (16.1, SPEC §2.10.6). Auth + FormData glue over `bookForCustomer`, which
 * owns every rule. `redirect()` throws, so it lives outside the try (house convention).
 *
 * On success the operator lands on the booking's own pane, which is where 16.1a's payment link
 * lives and where the unpaid booking is cancelled from.
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
    const q = new URLSearchParams({ date, booked: "1" });
    redirect(`/admin/calendar/${encodeURIComponent(String(result.reservation.id))}?${q.toString()}`);
  }

  // Nothing was written, so the form comes back with what the operator typed — a caller is on
  // the line, and retyping their details is the thing not to make them wait through.
  await stashFormDraft(SURFACE, formData);
  const q = new URLSearchParams({ date, vessel: vesselId, time, err: result ? result.reason : "unreachable" });
  if (offeringId) q.set("offering", offeringId);
  redirect(`${SURFACE}?${q.toString()}`);
}
