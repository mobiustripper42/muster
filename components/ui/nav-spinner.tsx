"use client";

import { useLinkStatus } from "next/link";

/**
 * Navigation loading spinner (#250) — shows WHILE the enclosing `<Link>`'s
 * navigation is in flight, i.e. after you click a link/row and the server is
 * fetching the next page or pane. This is the navigation counterpart to
 * `<SubmitButton>`'s in-flight spinner (which covers form submits); together they
 * cover both kinds of "clicked → now waiting on the server" delay.
 *
 * Must render as a **descendant of a `<Link>`** — `useLinkStatus` reads the nearest
 * parent Link's pending state (Next 15.3+). Renders nothing until pending, so it
 * adds no box when idle. currentColor, calm. The Link stays a server component;
 * only this tiny island is client.
 */
export function NavSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent ${className ?? ""}`}
    />
  );
}
