"use client";

import { useState, useTransition } from "react";
import { recordSent } from "../../app/(admin)/admin/outbox/actions";

/**
 * Single-click relay Send (DEC-030) — the ONE `'use client'` island on the admin
 * surfaces, a deliberate exception to the no-client-JS posture (DEC-026). An
 * `sms:` link is a plain anchor: tapping it hands off to the native Messages app
 * and cannot also record "sent" server-side in the same tap without JS. So:
 *
 *   Send (green) → one tap: the native anchor opens the composer (reliable OS
 *   handoff, unchanged), AND onClick fires `recordSent` + flips this card
 *   optimistically to Resend + a "sent · <time>" line.
 *   Resend (white) → re-opens the same composer; no state change (the recovery
 *   for "the first text didn't actually go out").
 *
 * "Sent" flips when the composer opens, NOT on confirmed delivery — same honest
 * caveat as the old two-tap; Resend is the out. No separate un-send.
 *
 * SSR-safe: `window`/navigation live in the native anchor's default behavior and
 * the click handler, never in render.
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
  const [, startTransition] = useTransition();

  if (!sent) {
    return (
      <a
        href={smsHref}
        onClick={() => {
          setSent(true);
          setLabel(`sent ${fmtNow()}`);
          startTransition(() => {
            void recordSent(entryId);
          });
        }}
        className="flex min-h-[52px] items-center justify-center border-t border-line bg-ok font-semibold text-white"
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
