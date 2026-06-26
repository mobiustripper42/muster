"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard button (#160) — a small `'use client'` island so the operator
 * can grab the message body or a phone number without selecting by hand (the
 * reliable cross-platform relay baseline, esp. for Google Voice on desktop). The
 * text it copies is ALSO rendered `select-all` next to it, so if the clipboard API
 * is blocked (insecure context / denied permission) the manual fallback still works.
 */
export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable/denied — the value is select-all alongside, so
          // the operator can still copy it by hand. No error surface needed.
        }
      }}
      className="min-h-[44px] shrink-0 rounded-lg border border-line bg-card px-3 text-xs font-medium text-ink"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
