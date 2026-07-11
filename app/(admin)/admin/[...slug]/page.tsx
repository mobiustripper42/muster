import { redirect } from "next/navigation";

/**
 * Catch-all for unmatched `/admin/*` paths (#352 follow-up, mirrors the crew one).
 * A mistyped or stale admin URL used to hit a hard 404; instead, bounce to the
 * admin hub, which then applies the normal gate (switch-up / sign-in / redirect
 * home for a non-admin). Next matches every real admin surface first — only a path
 * with no matching route lands here.
 */
export const dynamic = "force-dynamic";

export default function AdminCatchAll() {
  redirect("/admin");
}
