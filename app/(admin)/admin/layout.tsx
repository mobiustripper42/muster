import type { ReactNode } from "react";
import { AdminNav } from "../../../components/admin/admin-nav";
import { readSubject } from "../../lib/auth";

/**
 * Admin route-group layout (#174) — renders the persistent {@link AdminNav} above
 * every `/admin/*` surface, but ONLY for an admin subject (`readSubject`), so a
 * signed-out visitor never sees operator chrome. This adds wayfinding, not a gate:
 * each page keeps its own inline auth gate (there's no middleware), so the layout
 * never decides what content renders — only whether the nav frame is drawn.
 * Server-rendered; the nav itself is the one client island.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const subject = await readSubject();
  return (
    <>
      {subject?.kind === "admin" && <AdminNav />}
      {children}
    </>
  );
}
