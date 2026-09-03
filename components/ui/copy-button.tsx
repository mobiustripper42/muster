"use client";

import { useState } from "react";

/**
 * Copy `value` to the clipboard, with a fallback for INSECURE contexts. The
 * operator runs the pilot over `http://mill-dev:3000` (Tailscale — not HTTPS, not
 * `localhost`), where `navigator.clipboard` is `undefined`; the legacy
 * `execCommand("copy")` over a temp textarea still works there. Returns false if
 * both paths fail (the value is also rendered `select-all`, so manual copy remains).
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    // NOT a fault (#854). This is BROWSER code, so `logSwallowed` would write to the
    // operator's devtools console and reach no server log at all. And a blocked
    // clipboard API is the expected case on `http://mill-dev:3000` (see the
    // docstring) — the legacy path below is the answer, not a report.
    // eslint-disable-next-line no-restricted-syntax -- expected in an insecure context
  } catch {
    // Secure-context API blocked/denied — fall through to the legacy path.
  }
  const ta = document.createElement("textarea");
  try {
    ta.value = value;
    ta.setAttribute("readonly", ""); // don't pop the mobile keyboard
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    return document.execCommand("copy");
    // NOT a fault (#854), same as above: browser-side, no server log to reach, and
    // `false` is already surfaced to the operator — the value renders `select-all`
    // so they can copy by hand.
    // eslint-disable-next-line no-restricted-syntax -- browser-side, already surfaced
  } catch {
    return false;
  } finally {
    // Always remove the node — even if select()/execCommand threw.
    ta.remove();
  }
}

/**
 * Copy-to-clipboard button (#160) — a small `'use client'` island so the operator
 * can grab the message body or a phone number without selecting by hand.
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
        if (await copyText(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      className="min-h-[44px] shrink-0 rounded-lg border border-line bg-card px-3 text-xs font-medium text-ink"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
