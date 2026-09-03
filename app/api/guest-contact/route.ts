import { NextResponse } from "next/server";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../lib/auth";
import { getRepo } from "../../lib/repo";
import { logSwallowed } from "../../lib/swallowed";

/**
 * Record that a guest was texted (#345 Part B). Hit best-effort (a keepalive fetch)
 * by the manifest's client Text button, right before it hands off to the phone's
 * Messages app. The server resolves WHO from the session (can't be forged), then
 * upserts the latest-contact row — so every crew member on the shift sees who's been
 * contacted and who hasn't.
 *
 * Progressive enhancement (DEC-026 posture held): the Text button's `sms:` link works
 * with no JS (Part A); this route is the enhancement that adds the shared mark. Auth =
 * any signed-in subject (the manifest is only shown to a shift's crew + the operator);
 * a tighter "on this shift" check is a possible follow-on, low blast radius (a spurious
 * mark on the operator's own manifest).
 */
export async function POST(req: Request): Promise<Response> {
  const subject = await readSubject();
  if (!subject) return new NextResponse(null, { status: 401 });

  let body: { reservationId?: unknown; shiftId?: unknown };
  try {
    body = await req.json();
    // NOT a fault (#854). An unparseable body on a POST is bad input, answered with the
    // 400 below. The caller is a keepalive fetch that can be cut off mid-flight by the
    // browser handing off to Messages, so a truncated body is expected here.
    // eslint-disable-next-line no-restricted-syntax -- truncated beacon body, not a fault
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const reservationId = typeof body.reservationId === "string" ? body.reservationId : "";
  const shiftId = typeof body.shiftId === "string" ? body.shiftId : "";
  if (!reservationId || !shiftId) return new NextResponse(null, { status: 400 });

  try {
    const repo = getRepo();
    // The contacter's display name, from their own record (crew or admin).
    const name =
      subject.kind === "admin"
        ? (await repo.getAdmin(subject.id))?.name
        : (await repo.getCrewMember(asId<"CrewMemberId">(subject.id)))?.name;
    await repo.recordGuestContact({
      reservationId: asId<"ReservationId">(reservationId),
      shiftId: asId<"ShiftId">(shiftId),
      contactedBy: subject.id,
      contactedByName: name ?? "someone",
      contactedAt: new Date().toISOString(),
    });
  } catch (e) {
    // The caller is a keepalive fetch with nothing watching the response, so this
    // 500 is seen by nobody: the crew member's Text button already handed off to
    // Messages and the manifest will simply never show they made contact.
    logSwallowed("api/guest-contact", e, "the guest-contact row was not recorded — the manifest will not show who texted");
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
