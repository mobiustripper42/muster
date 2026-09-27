import type { ReactNode } from "react";
import { AppLink } from "../ui/app-link";
import { BackLink } from "../ui/back-link";

/**
 * The list-plus-detail frame (issue #1104) — a list on the left, the selected thing's pane on the
 * right with **Close ✕** at its top, and below desktop width the pane full screen with the list
 * hidden (DEC-085). `/admin/shifts` had it first; the calendar and the reservation page use the
 * same one, so every "click a thing, see it beside the list" in the admin reads the same way.
 *
 * **Two proportions, because the lists differ.** The shift board is a column of cards and wants
 * room for the cockpit (3:4, each column scrolling on its own — #253). The calendar is a wide grid
 * across the whole fleet and keeps its width; its pane is narrow and sticks as the page scrolls
 * (operator, 2026-09-26). A pane taller than the window scrolls on its own (issue #1104 part 3):
 * pinned, its foot — a booking's Book it, a paid booking's last actions — was out of reach until
 * the grid beside it ran out. Written as two literal class sets, not interpolated, so Tailwind sees
 * every class.
 *
 * Server component, no JS: which pane is open is the URL, and Close is a link back to the list.
 */
const LAYOUT = {
  shifts: {
    frame: "lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)] lg:gap-6",
    list: "hidden min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:gap-4 lg:overflow-y-auto lg:[scrollbar-gutter:stable] lg:pr-1",
    pane: "flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:[scrollbar-gutter:stable] lg:pr-1",
  },
  calendar: {
    frame: "lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-5",
    list: "hidden min-w-0 lg:block",
    pane: "flex min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:[scrollbar-gutter:stable] lg:pr-1",
  },
} as const;

export function MasterDetail({
  layout,
  list,
  pane,
  closeHref,
  back,
  listTestId,
  paneTestId,
}: {
  layout: keyof typeof LAYOUT;
  list: ReactNode;
  pane: ReactNode;
  /** Where Close ✕ goes: the list, with nothing selected. */
  closeHref: string;
  /** The way out below desktop, where the pane is the whole screen. Omit when the pane draws its
   *  own (the shift cockpit's "← All shifts"). */
  back?: { href: string; label: string };
  listTestId?: string;
  paneTestId?: string;
}) {
  const c = LAYOUT[layout];
  return (
    <div className={c.frame}>
      <div className={c.list} {...(listTestId ? { "data-testid": listTestId } : {})}>
        {list}
      </div>
      <div className={c.pane} {...(paneTestId ? { "data-testid": paneTestId } : {})}>
        <div className="hidden lg:flex lg:justify-end">
          <AppLink href={closeHref} className="btn-quiet inline-flex min-h-9 items-center px-1.5 text-xs">
            Close<span aria-hidden="true">&nbsp;✕</span>
          </AppLink>
        </div>
        {back ? (
          <div className="lg:hidden">
            <BackLink href={back.href}>{back.label}</BackLink>
          </div>
        ) : null}
        {pane}
      </div>
    </div>
  );
}
