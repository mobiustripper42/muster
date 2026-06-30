"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { claimSeat as claimSeatService } from "@core/asks/claim.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../lib/auth";
import { selfServeEnabled } from "../../../lib/flags";
import { getRepo } from "../../../lib/repo";

/**
 * Claim an Open seat from /crew/open (SPEC §2.7.2, DEC-075/078). Auth + glue over
 * the `claimSeat` domain service, which re-validates the FULL claimable predicate
 * server-side (native role, window, Open+required, §1.3 pool) and performs the
 * guarded `Open → Confirmed` CAS — so this layer only gates the flag + the crew
 * session and maps the result code to feedback. A claim fires no asks, so there's
 * nothing to forward to the outbox (unlike a bail).
 *
 * Feedback rides redirect params as codes only (DEC-026): success lands on /crew
 * (the seat is now in My shifts); a clean-failure (`just_taken` / `conflict`) or
 * any other code returns to /crew/open with the active filter preserved.
 * `redirect()` throws by design → it stays OUTSIDE the try.
 */
export async function claimSeat(formData: FormData): Promise<void> {
  if (!selfServeEnabled()) redirect("/crew");
  const subject = await readSubject();
  const seatId = String(formData.get("seatId") ?? "");
  const backRaw = String(formData.get("back") ?? "/crew/open");
  const back = backRaw.startsWith("/crew/open") ? backRaw : "/crew/open";
  if (!subject || subject.kind !== "crew" || !seatId) redirect("/crew");

  type ClaimResult = Awaited<ReturnType<typeof claimSeatService>>;
  let result: ClaimResult | null = null;
  try {
    result = await claimSeatService(
      getRepo(),
      asId<"CrewMemberId">(subject.id),
      asId<"SeatId">(seatId),
      new Date(),
    );
  } catch {
    redirect(withParam(back, "claim_error", "unavailable"));
  }

  if (result!.code === null) {
    // Confirmed — it now shows in My shifts (§2.6.2).
    revalidatePath("/crew");
    redirect(`/crew?claimed=${encodeURIComponent(String(result!.seat?.shiftId ?? ""))}`);
  }

  // just_taken / conflict get their own copy; every other code (not_claimable,
  // ineligible, gone, the dormant requires_confirmation stub) is a generic miss.
  const code = result!.code;
  const feedback = code === "just_taken" || code === "conflict" ? code : "unavailable";
  revalidatePath(back);
  redirect(withParam(back, "claim_error", feedback));
}

/** Append/replace one query param on a relative `/crew/open[...]` path. */
function withParam(path: string, key: string, value: string): string {
  const u = new URL(path, "http://local");
  u.searchParams.set(key, value);
  const qs = u.searchParams.toString();
  return qs ? `${u.pathname}?${qs}` : u.pathname;
}
