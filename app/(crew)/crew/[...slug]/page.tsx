import { redirect } from "next/navigation";

/**
 * Catch-all for unmatched `/crew/*` paths (#352 follow-up). A mistyped or stale
 * crew URL (`/crew/anything`) used to hit a hard 404; instead, send them back to
 * the crew home — the far friendlier landing than a dead 404 for a crew member on
 * their phone. Next matches more-specific routes first, so every real crew surface
 * (`/crew/threads`, `/crew/shift/[id]`, `/crew/open`, …) still wins; only a path
 * with no matching route reaches this.
 */
export const dynamic = "force-dynamic";

export default function CrewCatchAll() {
  redirect("/crew");
}
