"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hold a transient `true` for a minimum duration (#250). Returns `true` while
 * `active` is true, then keeps returning `true` for at least `minMs` after it
 * drops. This is what makes an in-flight spinner actually visible: a server round-
 * trip or navigation can resolve in a few milliseconds locally, so a spinner tied
 * straight to the raw pending flag flashes by unseen. Held for ~600ms, every click
 * shows a clear spinner — even an instant one — without lingering annoyingly on a
 * genuinely slow one (the hold is a floor, not an addition).
 *
 * Caveat: only holds while the component stays mounted. A spinner on an element
 * that unmounts when the navigation completes (a button that redirects to a new
 * page) still can't outlive that unmount — but same-surface cases (a board row
 * opening a pane, a non-redirecting submit) get the full floor.
 */
export function useHeld(active: boolean, minMs = 600): boolean {
  const [held, setHeld] = useState(active);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      if (startRef.current === null) startRef.current = Date.now();
      setHeld(true);
      return;
    }
    if (startRef.current === null) return;
    const wait = Math.max(0, minMs - (Date.now() - startRef.current));
    const timer = setTimeout(() => {
      setHeld(false);
      startRef.current = null;
    }, wait);
    return () => clearTimeout(timer);
  }, [active, minMs]);

  return held;
}
