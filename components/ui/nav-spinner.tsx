"use client";

import { useLinkStatus } from "next/link";

/**
 * Navigation loading spinner (#250) — shows WHILE the enclosing `<Link>`'s
 * navigation is in flight: from the click until the next page/pane has actually
 * rendered. `useLinkStatus().pending` is the accurate signal (it stays true the
 * whole navigation, unlike a URL-change signal that fires a beat early), so the
 * spinner lasts the entire load and can't vanish while you're still waiting.
 *
 * This is the navigation counterpart to `<SubmitButton>`'s in-flight spinner for
 * form submits — together, clicking anything (link or button) shows a spinner
 * right where you clicked, for as long as the server is working.
 *
 * Must render as a **descendant of a `<Link>`** (useLinkStatus reads the nearest
 * Link). Renders nothing until pending, so no box when idle. `size` defaults to a
 * prominent 20px; pass a bigger one for a large target like a row. currentColor.
 */
export function NavSpinner({
  className,
  size = "h-5 w-5",
}: {
  className?: string;
  /** Tailwind height/width classes for the ring (default 20px). */
  size?: string;
}) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block ${size} shrink-0 animate-spin rounded-full border-[3px] border-current border-r-transparent ${className ?? ""}`}
    />
  );
}
