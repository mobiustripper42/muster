"use client";

import { useEffect } from "react";
import { useParams, usePathname } from "next/navigation";

/**
 * Presence + read beacon (#117, DEC-071) — the DEC-055 client-island carve-out on
 * an otherwise pure-server surface. On every crew navigation it POSTs to
 * /crew/activity: "I'm in the app" (presence, DEC-047), plus "I'm reading this
 * thread" (read-state, DEC-069) when the route carries a `threadId`.
 *
 * Why a client island and not a server-GET write: read/presence both *silence* a
 * doorbell ring, and the doorbell's bias is fail-toward-ringing — so a false
 * positive is the dangerous direction. A GET-render write fires on prefetch,
 * bfcache restores, link-unfurlers, and bots; the doorbell SMS itself carries a
 * tap-to-open link, so a carrier unfurling it would mark the thread read *before*
 * the human taps and cancel the notification's own follow-ups. A `useEffect` runs
 * only on a real human view in a real browser — immune to all of that. Keyed on the
 * pathname so it re-fires on each navigation (a layout-mounted effect would run
 * once per session otherwise).
 */
export function ActivityBeacon() {
  const pathname = usePathname();
  const params = useParams();
  const threadId =
    params && typeof params.threadId === "string" ? params.threadId : undefined;

  useEffect(() => {
    void fetch("/crew/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(threadId ? { threadId } : {}),
      keepalive: true,
    }).catch(() => {
      // Best-effort: a missed beacon just means the doorbell errs toward ringing.
    });
  }, [pathname, threadId]);

  return null;
}
