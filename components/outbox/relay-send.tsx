"use client";

import { useState } from "react";
import { recordSent } from "../../app/(admin)/admin/outbox/actions";

/**
 * Single-click relay Send (DEC-030) — the ONE `'use client'` island on the admin
 * surfaces, a deliberate exception to the no-client-JS posture (DEC-026).
 *
 * PROGRESSIVE ENHANCEMENT — it's an `<a href="sms:…">`, so with NO JS the composer
 * still opens via the native anchor (the graceful baseline). When hydrated, the
 * `onClick` takes over and OWNS THE ORDER, because the order matters:
 *   1. flip optimistically to Resend + "sent · <time>" (instant paint),
 *   2. `await recordSent` — let the server write FINISH,
 *   3. THEN open the composer (`window.location`).
 * Why await before navigating: opening the `sms:` composer is a navigation that
 * ABORTS an in-flight request — fire-and-forget `recordSent` got killed mid-flight
 * ("Failed to fetch") and never persisted, so a refresh showed Send again. The
 * record is quick (one local write); the flip already painted, so the ~100ms
 * before Messages opens is invisible. If the write fails we still open the
 * composer (the text matters most) — Resend is the recovery.
 *
 * "Sent" flips when you fire Send, NOT on confirmed delivery — same honest caveat
 * as the old two-tap. No separate un-send.
 */
export function RelaySend({
  entryId,
  smsHref,
  initialSent,
  initialSentLabel,
}: {
  entryId: string;
  smsHref: string;
  initialSent: boolean;
  initialSentLabel: string | null;
}) {
  const [sent, setSent] = useState(initialSent);
  const [label, setLabel] = useState(initialSentLabel);

  if (!sent) {
    return (
      <a
        href={smsHref}
        onClick={async (e) => {
          // Own the order: paint the flip, let the write finish, THEN navigate
          // to the composer (navigation aborts an in-flight request).
          e.preventDefault();
          setSent(true);
          setLabel(`sent ${fmtNow()}`);
          try {
            await recordSent(entryId);
          } catch {
            // Network hiccup: the flip stays, the text still goes — Resend covers
            // re-send and a refresh will show the un-persisted truth.
          }
          window.location.href = smsHref;
        }}
        className="flex min-h-[52px] w-full items-center justify-center border-t border-line bg-ok font-semibold text-white"
      >
        Send
      </a>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
      <a
        href={smsHref}
        className="rounded-lg border border-line bg-card px-4 py-1.5 text-sm font-medium text-ink"
      >
        Resend
      </a>
      <span className="text-xs text-muted">
        {label ?? "sent"} · awaiting reply
      </span>
    </div>
  );
}

/** Local clock h:mm AM/PM — matches the page's server-rendered `fmtTime`. */
function fmtNow(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
