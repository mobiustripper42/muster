"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import { recordSent } from "../../app/(admin)/admin/outbox/actions";

/**
 * Single-click relay Send (DEC-030) — the ONE `'use client'` island on the admin
 * surfaces, a deliberate exception to the no-client-JS posture (DEC-026).
 *
 * SEND PATH (#160): prefer the **Web Share** sheet (`navigator.share({text})`),
 * which on Android surfaces **Google Voice** so the operator relays from their GV
 * number, not their personal cell. Web Share has no recipient field, so the crew
 * member is a manual conversation-pick in GV (the card shows the name + number for
 * the first-time lookup). Where Web Share is absent (desktop / where GV isn't a
 * share target) it falls back to the **`sms:` composer** (`smsHref`, prefilled with
 * the number); with NO JS at all the `<a href="sms:…">` anchor is the baseline.
 *
 * ORDER matters and differs by path:
 *  - **Share** opens an overlay, not a navigation, so it does NOT abort
 *    `recordSent` — open the sheet first (synchronously, in the tap gesture, or the
 *    user-activation is lost), then record.
 *  - **sms:** navigating to the composer ABORTS an in-flight request, so record
 *    FIRST, then navigate (the old, hard-won ordering).
 * Either way the flip to "sent" paints synchronously first (`flushSync`).
 *
 * "Sent" flips when you fire Send, NOT on confirmed delivery — same honest caveat
 * as before; Resend re-fires. No separate un-send.
 */
export function RelaySend({
  entryId,
  shareText,
  smsHref,
  initialSent,
  initialSentLabel,
}: {
  entryId: string;
  /** The full message (body + magic link) for the Web Share sheet — no recipient. */
  shareText: string;
  /** Prefilled `sms:` href for the fallback — null when the crew member has no phone. */
  smsHref: string | null;
  initialSent: boolean;
  initialSentLabel: string | null;
}) {
  const [sent, setSent] = useState(initialSent);
  const [label, setLabel] = useState(initialSentLabel);

  function fire() {
    // Paint the flip SYNCHRONOUSLY first — committed before either the share sheet
    // or the sms: hand-off can win the race.
    flushSync(() => {
      setSent(true);
      setLabel(`sent ${fmtNow()}`);
    });
    const canShare =
      typeof navigator !== "undefined" && typeof navigator.share === "function";
    if (canShare) {
      // Share sheet (Google Voice on Android). Called synchronously here to keep
      // the tap's user-activation; the overlay doesn't abort recordSent, so record
      // after. A dismissed sheet rejects — the flip stays, Resend recovers.
      void navigator
        .share({ text: shareText })
        .catch(() => {})
        .finally(() => {
          void recordSent(entryId).catch(() => {});
        });
      return;
    }
    // Fallback: the sms: composer. Record BEFORE navigating (navigation aborts an
    // in-flight request); the text matters most, so navigate even if the write fails.
    void recordSent(entryId)
      .catch(() => {})
      .finally(() => {
        if (smsHref) window.location.href = smsHref;
      });
  }

  if (!sent) {
    return (
      <a
        href={smsHref ?? undefined}
        onClick={(e) => {
          e.preventDefault();
          fire();
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
        href={smsHref ?? undefined}
        onClick={(e) => {
          e.preventDefault();
          fire();
        }}
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
