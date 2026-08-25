"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bailWithDerivedLateness } from "@core/asks/ask-loop.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";

/**
 * "I can't make it" (SPEC §2.6.3, #56) — a confirmed crew member drops
 * their own seat. Auth + glue over the existing `bail()` rails (DEC-019,
 * DEC-128): the domain logs `shift_bailed`, clears the seat, and rests it
 * `Open` — re-crewing is the tick's job now (#483), not an inline re-ask.
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
      errorCode =
        out.code === "raced"
          ? "stale"
          : out.code === "trainee_seat"
            ? "trainee_seat" // DEC-087: a ride isn't a bail — the office unstaffs
            : null;
      // No re-asks to forward: the bail rests the seat Open and leaves re-crewing
      // to the tick (DEC-128, #483).
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

/**
 * "Got it" — mark this shift's change banner seen, for THIS crew member only (#769, DEC-158).
 *
 * Two crew on the same boat dismiss independently: "seen" is not a property of the shift. The
 * write is a `last_seen_at` upsert and nothing else — the change rows stay, because a later
 * change still has to be able to describe the window it belongs to, and because deleting them
 * would quietly make the dismissal permanent (re-raise is `changed_at > last_seen_at`, not a
 * flag anyone resets).
 *
 * A crew-session write, so it re-reads the subject rather than trusting the form: the shift id
 * arrives from the client and the crew member id must not.
 */
export async function dismissShiftChanges(formData: FormData): Promise<void> {
  const shiftId = String(formData.get("shiftId") ?? "");
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew" || !shiftId) redirect("/crew");

  try {
    await getRepo().markShiftChangesSeen(
      asId<"ShiftId">(shiftId),
      asId<"CrewMemberId">(subject.id),
      new Date().toISOString(),
    );
  } catch {
    // Best-effort: a failed dismiss leaves the banner up, which is the safe direction. The crew
    // member can tap again; the alternative (an error screen over a card they came to read) is
    // worse than a banner that did not go away.
  }
  revalidatePath(`/crew/shift/${shiftId}`);
  revalidatePath("/crew");
  redirect(`/crew/shift/${shiftId}`);
}
