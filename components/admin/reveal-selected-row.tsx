"use client";

import { useEffect } from "react";

/**
 * Keep the operator's place in the board list when they open a shift (#365).
 *
 * On the `lg` two-pane board (DEC-085) each column scrolls independently and the
 * window never scrolls. But clicking a row navigates `?sel=<id>`, the board
 * server-re-renders, and the independently-scrolling `board-col` resets to the
 * top — on a long list you lose the row you just clicked.
 *
 * This scopes the reveal to `board-col` ONLY: it nudges just that column's
 * `scrollTop` so the selected row sits near the top, and never touches the window.
 * A pure-CSS `#shiftrow-<id>` URL fragment was rejected precisely because native
 * `scrollIntoView` bubbles up through every scrollable ancestor and drags the
 * whole page ~50px on short desktop windows (breaking the DEC-085 "window never
 * scrolls on lg" guarantee). Imperative, board-col-scoped scroll is the only way
 * to reveal the row without that leak.
 *
 * **A `'use client'` island in the DEC-026 family (DEC-114)** — joining the
 * redirect-feedback (DEC-097), submit-spinner (DEC-089), and copy/relay (DEC-030)
 * islands: JS is an *enhancement* here, never a requirement. With JS off the row
 * still selects and the cockpit still renders; only the auto-place-keeping is lost
 * and the column just opens at the top as it does today.
 *
 * Inert on mobile: below `lg` the board list is `display:none`, so `offsetParent`
 * is null and the effect bails, leaving the full-screen drill-in at top (Next's
 * default scroll-to-top). **Fragility (DEC-114):** this mobile guard keys off
 * `display:none` — if the board-hide ever becomes `visibility:hidden`, offsetParent
 * is no longer null and the island would fire on mobile; revisit here if so.
 */
export function RevealSelectedRow({ sel, nav }: { sel: string; nav: string }) {
  // `useEffect` (not `useLayoutEffect`) on purpose: this is a "use client"
  // component that Next still SSRs, and `useLayoutEffect` warns during SSR. The
  // reveal runs a frame after paint; any flash is negligible (board-col is
  // reconciled across client nav, so it usually isn't even reset to 0 first).
  useEffect(() => {
    const col = document.querySelector<HTMLElement>(
      '[data-testid="board-col"]',
    );
    const row = document.getElementById(`shiftrow-${sel}`);
    // offsetParent is null when board-col is display:none (mobile) — bail, so the
    // window/drill-in is left exactly where Next put it (the top).
    if (!col || !row || col.offsetParent === null) return;

    const colRect = col.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const OFFSET = 16; // breathing room from the column's top edge (was scroll-mt-4)
    // Only move if the row isn't already comfortably in view — leaving an
    // already-visible selection undisturbed avoids a jarring re-jump.
    if (rowRect.top < colRect.top + OFFSET || rowRect.bottom > colRect.bottom) {
      col.scrollTop += rowRect.top - colRect.top - OFFSET;
    }
    // Re-run on `nav` too, not just `sel`: any board re-render (preset/crew/mode
    // change while the pane stays open) resets board-col's scroll, so the still-
    // selected row must be re-revealed even though `sel` didn't change. `nav` is
    // the host's filter+mode param string, which changes on exactly those navs.
  }, [sel, nav]);

  return null;
}
