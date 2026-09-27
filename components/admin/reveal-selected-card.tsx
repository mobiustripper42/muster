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
 * the reason this is its own island: the card has TWO scrollers — the list column (vertical; since
 * the PR #1110 review the calendar scrolls like Shifts, each column on its own and the window not
 * at all) and the grid's `overflow-x-auto` wrapper (sideways). Native `scrollIntoView` moves every
 * scrollable ancestor, so one call brings the card into view in both. "Visible" is measured
 * against the list column's box (`cal-list-col`, a DUAL-PURPOSE hook — e2e selects it too), falling
 * back to the window where there is no column.
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
    const c = card.closest<HTMLElement>('[data-testid="cal-list-col"]')?.getBoundingClientRect();
    const MARGIN = 16;
    const top = Math.max(c?.top ?? 0, 0) + MARGIN;
    const bottom = Math.min(c?.bottom ?? window.innerHeight, window.innerHeight) - MARGIN;
    const offColumn = r.top < top || r.bottom > bottom;
    const offGrid = s !== undefined && (r.left < s.left || r.right > s.right);
    if (offColumn || offGrid) {
      card.scrollIntoView({ block: "center", inline: "center" });
    }
  }, [selectedKey]);

  return null;
}
