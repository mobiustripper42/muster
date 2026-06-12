"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import { recordSent } from "../../app/(admin)/admin/outbox/actions";

/**
 * Single-click relay Send (DEC-030) — the ONE `'use client'` island on the admin
 * surfaces, a deliberate exception to the no-client-JS posture (DEC-026). An
 * `sms:` link is a plain anchor: tapping it hands off to the native Messages app
 * and cannot also record "sent" server-side in the same tap without JS. So one
 * tap does all three:
 *
 *   Send (green)  → `flushSync` the optimistic flip to Resend + "sent · <time>"
 *                   (committed to the DOM BEFORE anything else), fire
 *                   `recordSent` (fire-and-forget), then open the composer.
 *   Resend (white) → re-opens the same composer; no state change (the recovery
 *                    for "the first text didn't actually go out").
 *
 * Why a `<button>` + `window.location`, not an `<a href="sms:">`: the anchor's
 * default navigation to the `sms:` URI races — and on desktop cancels — the
 * React commit + the server call, so the flip never paints. We own the order
 * instead: paint first (flushSync), record, then hand off to the composer (a
 * custom-scheme nav that doesn't unload the page on iOS/Android).
 *
 * "Sent" flips when the composer opens, NOT on confirmed delivery — same honest
 * caveat as the old two-tap; Resend is the out. No separate un-send.
 *
 * SSR-safe: `window` is only touched inside click handlers, never in render.
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

  const openComposer = () => {
    window.location.href = smsHref;
  };

  if (!sent) {
    return (
      <button
        type="button"
        onClick={() => {
          // Paint the flip to the DOM first, so the composer hand-off can't
          // race it away.
          flushSync(() => {
            setSent(true);
            setLabel(`sent ${fmtNow()}`);
          });
          void recordSent(entryId);
          openComposer();
        }}
        className="flex min-h-[52px] w-full items-center justify-center border-t border-line bg-ok font-semibold text-white"
      >
        Send
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
      <button
        type="button"
        onClick={openComposer}
        className="rounded-lg border border-line bg-card px-4 py-1.5 text-sm font-medium text-ink"
      >
        Resend
      </button>
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
