"use client";

import { useEffect } from "react";

/**
 * Keep the selected calendar card in view when its pane opens (#1104).
 *
 * Clicking a card navigates (`?hold=`, `?release=`, or a reservation's own route), the page
 * re-renders, and two things reset: the grid column scrolls back to the top of the day (8a), and
 * the grid's own sideways scroll snaps back to the first boat. With the pane open the grid is also
 * 360px narrower, so the card you just clicked is usually off screen — the operator asked for the
 * selection to stay visible.
 *
 * The same job `RevealSelectedRow` does for the shift board (DEC-114), with one difference that is
 * the reason this is its own island: the grid's own box scrolls BOTH ways. Since issue #1128 it is
 * the one scroller on the left with a pane open — the controls and legend stay put above it, and
 * the row of boat names is pinned to its top. "Visible" is measured against that box
 * (`data-cal-scroll`) BELOW the pinned row (`data-cal-head`), because a card under the row is
 * covered, falling back to the window. Native `scrollIntoView` moves every scrollable ancestor, so
 * one call brings the card into view either way.
 *
 * Only moves when the card is not already comfortably visible, so clicking a card that is on
 * screen does not jolt the page. Inert when the grid is hidden (below `lg` with a pane open, the
 * pane is the whole screen): `offsetParent` is null and it bails.
 *
 * A `'use client'` island in the DEC-026 family: with JS off the pane still opens and the page
 * simply stays at the top, as it did before.
 */
export function RevealSelectedCard({ selectedKey }: { selectedKey: string }) {
  useEffect(() => {
    if (!selectedKey) return;
    const card = document.querySelector<HTMLElement>("[data-cal-selected]");
    if (!card || card.offsetParent === null) return;

    const r = card.getBoundingClientRect();
    const scroller = card.closest<HTMLElement>("[data-cal-scroll]");
    const s = scroller?.getBoundingClientRect();
    const head = scroller?.querySelector<HTMLElement>("[data-cal-head]")?.offsetHeight ?? 0;
    const MARGIN = 16;
    const top = Math.max(s?.top ?? 0, 0) + head + MARGIN;
    const bottom = Math.min(s?.bottom ?? window.innerHeight, window.innerHeight) - MARGIN;
    const offColumn = r.top < top || r.bottom > bottom;
    const offGrid = s !== undefined && (r.left < s.left || r.right > s.right);
    if (offColumn || offGrid) {
      card.scrollIntoView({ block: "center", inline: "center" });
    }
  }, [selectedKey]);

  return null;
}
