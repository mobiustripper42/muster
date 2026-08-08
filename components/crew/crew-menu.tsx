import { AppLink } from "../ui/app-link";
import { SubmitButton } from "../ui/submit-button";
import { signOut } from "../../app/(crew)/crew/actions";
import { switchToAdmin } from "../../app/lib/switch-actions";
import type { CrewLink } from "../../app/lib/crew-links";
import { CrewMenuModal } from "./crew-menu-modal";

/**
 * The crew drawer (#644) — the hamburger at the far right of `CrewHeader` and the panel it opens.
 *
 * **`<details>`, and NOT the admin drawer's client island — this is the load-bearing decision.**
 * `components/admin/admin-nav.tsx` opens its drawer with `useState`, which means it needs JS. The
 * admin nav gets away with that because it renders its links inline at `lg`, so a JS-less desktop
 * operator still has navigation. **Crew has no such fallback.** The hub's four navigation cards
 * moved in here (`app/lib/crew-links.ts`), so a JS-only drawer would leave a crew member with JS
 * off holding a page with no way off it — strictly worse than before this task. Those cards were
 * plain server-rendered links and worked with nothing.
 *
 * DEC-147 rule 2 is explicit that "progressive enhancement holds where it can", and here it
 * genuinely can: `<details>` is open/close with zero JS, gives the summary keyboard operation for
 * free, and — the part that pays for itself — the browser removes the panel's contents from both
 * the render and the tab order when it is shut. The island version needed `inert` to fake that,
 * and an `inert`-less translate-off-screen panel is the classic invisible-but-tabbable bug.
 *
 * **Three things `<details>` alone got wrong, all found by the operator on the first read
 * (2026-08-05), all fixed in `crew-menu-modal.tsx` as enhancement rather than by giving up the
 * no-JS base:**
 *
 * 1. **No visible way to close it at 375px.** The panel is `w-64 max-w-[80vw]` pinned right, which
 *    covers the top-right corner where the summary lives — so the only control that could shut the
 *    drawer was underneath it. `group-open:z-50` lifts the summary above the panel and the icon
 *    swaps to an ✕. **The e2e test did not catch this** because Playwright clicks an element by
 *    handle, not by screen position, so it happily "clicked" a covered control.
 * 2. **The page behind stayed operable.** The backdrop blocks the pointer, but focus does not care
 *    — the pay-period `<select>` on `/crew/time` still changed value with the drawer open. That
 *    needs `inert`, which CSS cannot apply to an element's siblings.
 * 3. **A tap on the dimmed page did nothing at all.** The `::before` hit-tests as the summary but
 *    does NOT activate it — a details toggles on clicks inside the summary's own border box. The
 *    earlier claim in this file that the backdrop "toggles the details shut" was simply wrong.
 *
 * What still holds with JS off: the drawer opens and closes on the summary (now visible in both
 * states), and every link and both forms work. What is lost: Escape, backdrop-tap, and the page
 * behind being inert. That is the right side of the trade — navigation still works.
 *
 * The current page's entry renders as a marked-current `<span>`, not a link: tapping it used to
 * navigate to the URL you were already on, firing the overlay spinner and changing nothing.
 */
export function CrewMenu({
  links,
  viewerIsActiveAdmin,
  current,
}: {
  links: CrewLink[];
  /** Dual-role person (DEC-093) — show the switch UP to admin. Gated server-side regardless. */
  viewerIsActiveAdmin: boolean;
  /** The route this page is, so its own entry renders as a marker rather than a link (#644). */
  current?: string;
}) {
  const rowClass =
    "flex min-h-[44px] items-center rounded-lg px-3 py-3 text-base text-ink";

  return (
    <details
      data-crew-menu
      className="group relative justify-self-end group-open:before:content-[''] open:before:fixed open:before:inset-0 open:before:z-30 open:before:bg-ink/40 open:before:content-['']"
    >
      {/* The backdrop is a `::before` on the DETAILS, not on the summary. It was on the summary
          first, which broke the drawer outright once the summary needed `z-50` to sit above the
          panel: `z-50` makes the summary a stacking context, so its `::before` can no longer paint
          BELOW the z-40 panel however negative its z-index — it covered the panel and swallowed
          every link in it. The details carries `position: relative` with `z-index: auto`, which is
          not a stacking context, so z-30 here means what it says: over the page, under the panel.

          `list-none` + the marker reset kills the default disclosure triangle in both engines. */}
      <summary
        aria-label="Open menu"
        className="relative z-50 flex size-[44px] cursor-pointer list-none items-center justify-center rounded-lg text-ink [&::-webkit-details-marker]:hidden"
      >
        {/* `group-open:z-50` puts the control ABOVE the panel. Without it, at 375px the panel
            (w-64, max-w-[80vw]) covers the top-right corner and there is NO visible way to close
            the drawer — the bug the operator hit. The icon swaps to an ✕ so the control reads as
            "close" once open, and both states share one 44px box so nothing shifts. */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
          className="group-open:hidden"
        >
          <path d="M4 6h14M4 11h14M4 16h14" />
        </svg>
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
          className="hidden group-open:block"
        >
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
      </summary>

      <div
        data-crew-menu-panel
        // `role="dialog"` + `aria-modal` match `admin-nav.tsx`'s panel. Without them a screen
        // reader announces a plain group and gives no signal that the rest of the page has gone
        // inert — which it has, so the silence is a lie about the state of the app.
        role="dialog"
        aria-modal="true"
        // Still "Menu", though the heading below reads "Muster" (#709).
        //
        // The operator called this "a tough call, not a slam dunk", and the split is what makes
        // it cost nothing. FOR "Muster": the crew app never says the product's name anywhere
        // else — this is the one place a crew member learns what they are using. AGAINST: a
        // screen reader announcing "Muster dialog" says nothing about what the thing IS.
        //
        // So they do different jobs. Visible label = branding; accessible name = description.
        // Changing this to "Muster" to "match" would trade the only description a non-sighted
        // user gets for a word they cannot act on.
        aria-label="Menu"
        // `h-dvh`, not `h-full` — the right unit, and NOT a fix for the bug below.
        //
        // `h-full` is `height:100%`, which on a fixed element resolves against the initial
        // containing block rather than what you can see. `dvh` means "full screen height" and
        // is what this wants. Kept on those merits alone.
        //
        // **The open bug it did NOT solve** (operator's phone, 2026-08-08, both apps): open the
        // drawer, scroll so the browser toolbar collapses, and a band of page shows below the
        // panel. `h-full` → `h-dvh` changed nothing there. The clue for whoever picks it up is
        // that the BACKDROP stops at the same line as the panel — and the backdrop is
        // `fixed inset-0`, which has no height of its own. So this is not the drawer being
        // short: fixed positioning itself is being bounded by something smaller than the visual
        // viewport, and the height property is the wrong end of it.
        //
        // Deliberately not filed (operator's call): the only symptom is a white box at the foot
        // of the screen while scrolling a menu you are about to tap, and no other effect was
        // found. Written here rather than in an issue so it is in front of the next person who
        // touches drawer sizing, instead of in a backlog they will not read.
        //
        // Do NOT try to confirm any of this in the e2e suite. Playwright's Chromium has a static
        // viewport with no collapsing toolbar and renders the drawer full-height either way — a
        // green test here would assert nothing and claim everything.
        className="fixed right-0 top-0 z-40 flex h-dvh w-64 max-w-[80vw] flex-col gap-1 border-l border-line bg-card px-4 pb-4 pt-[22px] shadow-lg"
      >
        {/* The heading comes to the ✕, not the other way round (#709). The ✕ IS the `<summary>`,
            which lives in the page header row OUTSIDE this panel and cannot move without giving
            up the no-JS toggle this whole component exists for (see the header note).

            `pt-[22px]` is MEASURED, not derived, and that is deliberate: the panel is
            `fixed top-0`, so it cannot see the page shell's top padding that puts the summary
            where it is. Measured 2026-08-08 at 375px — summary box y=22.5 h=44 (centre 44.5);
            with pt-22 the heading's 44px box centres at 44, half a pixel out. Re-measure if the
            crew shell's top padding changes; the numbers are here so the next person can, rather
            than nudging until it looks right. */}
        <p className="mb-2 flex h-[44px] items-center px-3 font-semibold text-ink">Muster</p>

        <div className="flex flex-col gap-1 overflow-y-auto">
          {links.map((l) =>
            // The entry for the page you are already on is NOT a link (operator, 2026-08-05).
            // Tapping it navigated to the same URL, which fired `AppLink`'s overlay spinner and
            // then changed nothing — a spinner that resolves to the same screen reads as a hang.
            // Rendered as a marked-current row instead: it says where you are and does nothing.
            l.href === current ? (
              <span key={l.href} aria-current="page" className={`${rowClass} bg-bg font-semibold text-accent`}>
                {l.label}
              </span>
            ) : (
              <AppLink key={l.href} href={l.href} prefetch={false} className={rowClass}>
                {l.label}
              </AppLink>
            ),
          )}
        </div>

        {/* Sign out sits at the bottom, away from the destinations — it is not a place to go, and
            on a shared or family phone with a standing 14-day session it is the one control that
            must always be findable (DEC-081). `mt-auto` keeps it off the end of the link list so a
            mis-tap on "How Muster works" cannot land on it. Both are server-action forms, so they
            post without JS like everything else here. */}
        <div className="mt-auto flex flex-col gap-1 border-t border-line pt-2">
          {viewerIsActiveAdmin && (
            <form action={switchToAdmin}>
              <SubmitButton className={`${rowClass} w-full text-accent`}>
                Switch to admin
              </SubmitButton>
            </form>
          )}
          <form action={signOut}>
            <SubmitButton className={`${rowClass} w-full text-muted`}>Sign out</SubmitButton>
          </form>
        </div>
      </div>
      <CrewMenuModal />
    </details>
  );
}
