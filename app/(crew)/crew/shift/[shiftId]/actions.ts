"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bailWithDerivedLateness } from "@core/asks/ask-loop.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";

/**
 * "I can't make it" (SPEC §2.6.3, #56) — a confirmed crew member gives up
 * their own seat. Auth + glue over the existing `bail()` rails (DEC-019):
 * the domain logs `shift_bailed`, clears the seat, and re-asks or rests
 * `Bailed` — nothing new here.
 *
 * Lateness is computed SERVER-SIDE at bail time from the shift's events
 * (DEC-028: notice shortfall vs the staffing horizon, clamped; raw signed
 * notice logged alongside) — never client-supplied.
 *
 * Ownership gate mirrors `respondToAsk`: the session subject must BE the
 * confirmed occupant of the seat — no bailing someone else by forging ids.
 * Feedback rides redirect params as codes/ids only (DEC-026): success lands on
 * /crew (this card is no longer theirs to see), errors come back here.
 * `redirect()` throws by design, so it stays OUTSIDE the try.
 */
export async function bailFromSeat(formData: FormData): Promise<void> {
  const subject = await readSubject();
  const seatId = String(formData.get("seatId") ?? "");
  const shiftId = String(formData.get("shiftId") ?? "");
  if (!subject || subject.kind !== "crew" || !seatId || !shiftId) {
    redirect("/crew");
  }
  const back = `/crew/shift/${encodeURIComponent(shiftId)}`;

  // null = success; otherwise the error code the card page maps to copy.
  let errorCode: string | null;
  try {
    const repo = getRepo();
    const seat = await repo.getSeat(asId<"SeatId">(seatId));
    if (
      !seat ||
      String(seat.shiftId) !== shiftId ||
      seat.state !== "Confirmed" ||
      seat.assignedCrewMemberId !== subject.id
    ) {
      // Not yours / already changed — the card they're looking at is stale.
      errorCode = "stale";
    } else {
      // Lateness derived in core (DEC-028) — occupant pinned to the session
      // subject, so a swap between reads can't bail the wrong person.
      const out = await bailWithDerivedLateness(
        repo,
        seat.id,
        new Date(),
        asId<"CrewMemberId">(subject.id),
      );
      errorCode = out.code === "raced" ? "stale" : null;
    }
  } catch {
    errorCode = "unavailable";
  }

  if (errorCode !== null) {
    revalidatePath(back);
    redirect(`${back}?bail_error=${errorCode}`);
  }
  revalidatePath("/crew");
  redirect(`/crew?bailed=${encodeURIComponent(shiftId)}`);
}
