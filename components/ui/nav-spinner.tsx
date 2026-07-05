"use client";

import { useLinkStatus } from "next/link";
import { useHeld } from "./use-held";

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
 * Link). Renders nothing until pending, so no box when idle.
 *
 * - **inline** (default): a small spinner in the link's flow (nav items, chips).
 * - **overlay**: a scrim over the nearest positioned ancestor (a card/row) with a
 *   big centered spinner — unmistakable "this row is loading," no collision with
 *   the row's own text. The enclosing Link must be inside a `relative` box.
 */
export function NavSpinner({
  className,
  size = "h-5 w-5",
  overlay = false,
}: {
  className?: string;
  /** Tailwind height/width classes for the ring. */
  size?: string;
  overlay?: boolean;
}) {
  const { pending } = useLinkStatus();
  // Held for a minimum beat so a fast navigation still shows a visible spinner.
  const showing = useHeld(pending);
  if (!showing) return null;

  const ring = (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block ${size} shrink-0 animate-spin rounded-full border-[3px] border-current border-r-transparent ${overlay ? "text-accent" : (className ?? "")}`}
    />
  );

  if (!overlay) return ring;

  return (
    <span
      className={`absolute inset-0 z-10 flex items-center justify-center rounded-card bg-card/70 ${className ?? ""}`}
    >
      {ring}
    </span>
  );
}
