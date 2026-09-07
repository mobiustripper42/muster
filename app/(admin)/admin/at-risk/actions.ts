"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { lean } from "@core/asks/lean.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../lib/auth";
import { relayAsks } from "../../../lib/channel";
import { getRepo } from "../../../lib/repo";
import { logSwallowed } from "../../../lib/swallowed";

/**
 * Lean on a specific person from a board row (SPEC §2.5, #43, DEC-026) — the
 * manual Tier-2 direct nudge. The domain rules (eligibility, double-ask guard,
 * bailer exclusion) live in `@core/asks/lean`; this is auth + glue. Feedback
 * rides redirect search params so the board stays a pure server component (no
 * client JS for one button). Params carry CODES/ids only, never prose — the
 * page maps them to copy, so a crafted URL can't put arbitrary text in Eric's
 * trusted UI.
 */
export async function leanOn(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") {
    redirect("/admin/at-risk"); // page renders its own signed-out state
  }

  const shiftId = String(formData.get("shiftId") ?? "");
  const crewMemberId = String(formData.get("crewMemberId") ?? "");
  if (!shiftId || !crewMemberId) redirect("/admin/at-risk");

  // `redirect()` works by throwing, so it must live OUTSIDE the try — only the
  // domain call is guarded (a repo outage becomes a mapped notice, not a 500).
  let param: string;
  try {
    const out = await lean(
      getRepo(),
      asId<"ShiftId">(shiftId),
      asId<"CrewMemberId">(crewMemberId),
      new Date(),
    );
    param = out.error
      ? `lean_error=${out.code ?? "unavailable"}`
      : // The leaned shift leaves the board (its ask is in flight), so the
        // notice needs the shift id to offer the cockpit as the watch path.
        `leaned=${encodeURIComponent(crewMemberId)}&leaned_shift=${encodeURIComponent(shiftId)}`;
    // Edge channel wiring (DEC-030): the fired ask → the pilot outbox.
    await relayAsks(out.ask ? [out.ask] : undefined);
  } catch (e) {
    logSwallowed("admin/at-risk:leanOn", e, "the lean-on ask was not placed, or was placed and not forwarded");
    param = "lean_error=unavailable";
  }
  revalidatePath("/admin/at-risk");
  redirect(`/admin/at-risk?${param}`);
}
