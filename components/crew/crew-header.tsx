import { cache } from "react";
import { AppLink } from "../ui/app-link";
import { readSubject } from "../../app/lib/auth";
import { getRepo } from "../../app/lib/repo";
import { messagingEnabled, timeClockEnabled } from "../../app/lib/flags";
import { visibleCrewLinks } from "../../app/lib/crew-links";
import { CrewMenu } from "./crew-menu";

/**
 * The one header for every crew surface (#644): back at the far left, heading centred, menu at
 * the far right — **one row**.
 *
 * **What it replaces and why.** Drill-in pages stacked a 44px `BackLink` ABOVE a left-aligned
 * `<h1>`, so the frame cost two rows on a phone. The operator's complaint (2026-08-05) was
 * vertical space generally, and the bigger half of it was the hub: five navigation cards pushed
 * "My shifts" to y=637 in an 812px viewport. The cards moved into `CrewMenu`; this row is what
 * the drill-ins get back. See `app/lib/crew-links.ts` for what's in the drawer and why.
 *
 * **A three-column grid, not flex.** The heading is centred against the VIEWPORT, not against
 * whatever space the back link leaves — with flex, a long back label would shove the title off
 * centre and each page would centre differently. Fixed 44px rails either side make every crew
 * screen's title land in the same place, which is the point of a shared frame. The rails are 44px
 * because that is the tap-target floor, so the layout constant and the accessibility constant are
 * the same number rather than two that can drift apart.
 *
 * **The back affordance is icon-only, and that is a real trade.** The old links were labelled
 * ("‹ Shifts", "‹ Messages", "‹ Home") and the label named the destination. A centred title needs
 * equal rails, and a variable-width label cannot give one. The destination survives in the
 * accessible name — `aria-label="Back to Shifts"` — so a screen reader still hears it and only
 * the sighted cue is lost. Flagged rather than buried: if the destination turns out to matter
 * visually, the fix is a labelled row and an off-centre title, and that is a different design.
 *
 * A server component: it resolves the feature flags and the dual-role check itself, so a page
 * adds a header with `<CrewHeader title="Time" back={{ href: "/crew", label: "Shifts" }} />` and
 * nothing else. `CrewMenu` is the client island underneath.
 */
/**
 * Does the viewer hold an ACTIVE admin row? — decides whether the drawer offers "Switch to
 * admin" (DEC-093). Best-effort: a DB hiccup hides the control rather than breaking the header on
 * every crew screen, and the escalation is gated server-side regardless.
 *
 * **Wrapped in React `cache`** so the header's lookup is deduped per request rather than repeated
 * (post-merge audit of #665). The header renders on ~9 routes, each of which already resolves its
 * own subject, so before #644 only the hub paid for this check and now every crew page does.
 *
 * Honest about what this does and doesn't buy: the drawer is on every route, so the *first*
 * lookup per request is inherent to the feature and cannot be cached away. What `cache` removes is
 * the lookup MULTIPLYING — a second `CrewHeader` in a branch, or any other consumer added later,
 * now shares the one result instead of issuing another round-trip.
 */
const isViewerActiveAdmin = cache(async (): Promise<boolean> => {
  const subject = await readSubject();
  if (!subject) return false;
  return getRepo()
    .getAdmin(subject.id)
    .then((a) => !!a?.active)
    .catch(() => false);
});

export async function CrewHeader({
  title,
  back,
  current,
}: {
  title: string;
  /** Omitted on `/crew` itself — the hub has nowhere above it to go. */
  back?: { href: string; label: string };
  /**
   * This page's own route. The drawer renders that entry as a marked-current row rather than a
   * link, because tapping it navigated to the URL you were already on — overlay spinner, no
   * change (operator, 2026-08-05). Passed explicitly because a Server Component cannot read the
   * pathname, and reading it would mean a client island for a static fact each page already knows.
   */
  current?: string;
}) {
  const viewerIsActiveAdmin = await isViewerActiveAdmin();

  const links = visibleCrewLinks({
    messaging: messagingEnabled(),
    timeClock: timeClockEnabled(),
  });

  return (
    <header className="grid grid-cols-[44px_1fr_44px] items-center gap-2">
      {back ? (
        <AppLink
          href={back.href}
          prefetch={false}
          data-crew-back
          aria-label={`Back to ${back.label}`}
          className="-ml-1 flex size-[44px] items-center justify-center rounded-lg text-accent"
        >
          {/* Drawn as an SVG at 26px rather than a text "‹" (operator, 2026-08-05: "can the little
              tiny back arrow be slightly larger"). The glyph rendered small and thin at any font
              size that kept the 44px box from growing — a stroked chevron scales without that
              trade, and matches the weight of the menu icon on the other rail. The TAP TARGET is
              unchanged at 44px; only the mark inside it grew. */}
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </AppLink>
      ) : (
        <span />
      )}

      {/* `truncate` rather than wrap: a two-line title would reintroduce the second row this
          task exists to remove. Crew headings are short by design (SPEC §2.6). */}
      <h1 className="truncate text-center text-lg font-semibold text-ink">{title}</h1>

      <CrewMenu links={links} viewerIsActiveAdmin={viewerIsActiveAdmin} current={current} />
    </header>
  );
}
