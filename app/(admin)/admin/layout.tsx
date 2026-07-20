import type { ReactNode } from "react";
import { TENANT_TIMEZONE } from "@core/config/tenant.js";
import { AdminNav } from "../../../components/admin/admin-nav";
import { readSubject } from "../../lib/auth";
import { TENANT_NAME } from "../../lib/tenant";
import { messagingEnabled } from "../../lib/flags";

/**
 * Admin route-group layout (#174) — renders the persistent {@link AdminNav} above
 * every `/admin/*` surface, but ONLY for an admin subject (`readSubject`), so a
 * signed-out visitor never sees operator chrome. This adds wayfinding, not a gate:
 * each page keeps its own inline auth gate (there's no middleware), so the layout
 * never decides what content renders — only whether the nav frame is drawn.
 * Server-rendered; the nav itself is the one client island — tenant + today's
 * vessel-local date (9.8) are computed HERE per request and passed down, so the
 * client island never mints a viewer-local date (DEC-032).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const subject = await readSubject();
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: TENANT_TIMEZONE,
  });
  return (
    <>
      {subject?.kind === "admin" && (
        <AdminNav tenant={TENANT_NAME} dateLabel={dateLabel} messaging={messagingEnabled()} />
      )}
      {children}
    </>
  );
}
