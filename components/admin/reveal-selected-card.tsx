"use client";

import { useEffect } from "react";

/**
 * Keep the selected calendar card in view when its pane opens (#1104).
 *
 * Clicking a card navigates (`?hold=`, `?release=`, or a reservation's own route), the page
 * re-renders, and two things reset: the window scrolls back to the top of the day (8a), and the
 * grid's own sideways scroll snaps back to the first boat. With the pane open the grid is also
 * 360px narrower, so the card you just clicked is usually off screen — the operator asked for
 * the selection to stay visible.
 *
 * The same job `RevealSelectedRow` does for the shift board (DEC-114), with one difference that
 * is the reason this is its own island: here the WINDOW scrolls on desktop (the calendar is not a
 * viewport-bounded column), so revealing the card is allowed to move the page, and native
 * `scrollIntoView` — which moves every scrollable ancestor — is exactly right. The grid's
 * `overflow-x-auto` wrapper and the window both bring the card into view in one call.
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
    const scroller = card.closest<HTMLElement>(".overflow-x-auto");
    const s = scroller?.getBoundingClientRect();
    const MARGIN = 16;
    const offWindow = r.top < MARGIN || r.bottom > window.innerHeight - MARGIN;
    const offGrid = s !== undefined && (r.left < s.left || r.right > s.right);
    if (offWindow || offGrid) {
      card.scrollIntoView({ block: "center", inline: "center" });
    }
  }, [selectedKey]);

  return null;
}
