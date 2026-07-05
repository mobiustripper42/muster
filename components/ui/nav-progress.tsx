"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Global navigation progress bar (#250) — a slim accent bar at the very top of the
 * viewport that appears the instant you click any internal link/row and stays until
 * the next page/pane has loaded. It's the counterpart to `<SubmitButton>`'s in-flight
 * spinner (form submits): together they mean "you clicked → the server is working"
 * for BOTH kinds of wait.
 *
 * Why a bar (not the per-link spinner): real navigations are often faster than the
 * eye, so a spinner tied to the exact link flashes for a few ms and is missed. This
 * bar has a **minimum display time** (`MIN_MS`) — even a 50ms nav shows a clear
 * sweep — and is a prominent full-width element you can't miss. One component in the
 * layout; zero per-link wiring.
 *
 * Mechanics (App Router has no router events): a capture-phase click listener starts
 * the bar on an internal-link click; a change in `pathname`+`searchParams` (the nav
 * completed) finishes it, held to `MIN_MS`. A fallback timeout clears it if a click
 * never resolves to a navigation (e.g. a link to the current URL).
 */
const MIN_MS = 500;
const FALLBACK_MS = 8000;

export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const startedAt = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      // Only internal navigations get the bar.
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("http") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.getAttribute("aria-disabled") === "true"
      )
        return;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      startedAt.current = Date.now();
      setActive(true);
      fallbackTimer.current = setTimeout(() => setActive(false), FALLBACK_MS);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The route changed → the navigation landed. Finish the bar, but keep it up for
  // at least MIN_MS from the click so a fast nav still shows a visible sweep.
  useEffect(() => {
    if (!active) return;
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    const wait = Math.max(0, MIN_MS - (Date.now() - startedAt.current));
    hideTimer.current = setTimeout(() => setActive(false), wait);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // Intentionally keyed to the resolved route, not `active`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  if (!active) return null;
  return (
    <div
      role="status"
      aria-label="Loading"
      className="pointer-events-none fixed inset-x-0 top-0 z-[10000] h-1 overflow-hidden bg-accent/20"
    >
      <div className="animate-navbar h-full w-1/3 rounded-r-full bg-accent" />
    </div>
  );
}
