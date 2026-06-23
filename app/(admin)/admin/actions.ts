"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readSubject } from "../../lib/auth";
import { getRepo } from "../../lib/repo";

/**
 * Operator engine pause/resume (#124, DEC-054) — flip the autonomous tick's
 * arm/disarm flag without a redeploy. Admin-gated; no-client-JS (DEC-026): the
 * /admin form posts here, we write the flag and redirect back with a code-only
 * param (the page maps it to copy). The cron keeps firing every 15 min; a paused
 * engine no-ops in the tick route — pause is enforced at the edge, `tick` stays
 * pure. The flag is written here at the service layer, never the engine core.
 */
export async function setEnginePaused(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") redirect("/admin");

  // The form carries the DESIRED new state in a hidden field, so the button
  // label ("Pause"/"Resume") and the write can't disagree.
  const paused = formData.get("paused") === "true";

  try {
    await getRepo().setEnginePaused(paused, new Date().toISOString());
  } catch {
    // A repo outage → a mapped notice, not a 500 (DEC-026). redirect() throws by
    // design, so it sits outside any further work.
    redirect("/admin?engine_error=unavailable");
  }
  revalidatePath("/admin");
  revalidatePath("/admin/at-risk");
  redirect(`/admin?engine=${paused ? "paused" : "running"}`);
}
