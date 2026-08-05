import { AppLink } from "../ui/app-link";
import { SubmitButton } from "../ui/submit-button";
import { signOut } from "../../app/(crew)/crew/actions";
import { switchToAdmin } from "../../app/lib/switch-actions";
import type { CrewLink } from "../../app/lib/crew-links";

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
 * **What it costs, stated rather than hidden:** no slide-in animation (a `<details>` cannot
 * animate its own disclosure without JS), and **Escape does not close it** — that is not a thing
 * native `<details>` does. Keyboard dismissal is Enter or Space on the summary, which still holds
 * focus once the panel is open, so the AC's "dismissable by keyboard" is met by that and not by
 * Escape. The backdrop is a `::before` on the summary, so a tap anywhere outside the panel toggles
 * the details shut — dismissal by tap, also with no JS.
 *
 * No active-link cue in here, deliberately: the header's centred title already names the current
 * surface, and `aria-current` would need the pathname, which would need a client island — the one
 * thing this file exists to avoid.
 */
export function CrewMenu({
  links,
  viewerIsActiveAdmin,
}: {
  links: CrewLink[];
  /** Dual-role person (DEC-093) — show the switch UP to admin. Gated server-side regardless. */
  viewerIsActiveAdmin: boolean;
}) {
  const rowClass =
    "flex min-h-[44px] items-center rounded-lg px-3 py-3 text-base text-ink";

  return (
    <details className="group relative justify-self-end">
      {/* `list-none` + the marker reset kills the default disclosure triangle in both engines.
          The `::before` is the backdrop: it only exists while open, covers the viewport beneath
          the panel, and — because it belongs to the summary — a tap on it toggles the drawer shut.
          That is the whole no-JS dismissal story. */}
      <summary
        aria-label="Open menu"
        className="flex size-[44px] cursor-pointer list-none items-center justify-center rounded-lg text-ink [&::-webkit-details-marker]:hidden group-open:before:fixed group-open:before:inset-0 group-open:before:z-30 group-open:before:bg-ink/40 group-open:before:content-['']"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 6h14M4 11h14M4 16h14" />
        </svg>
      </summary>

      <div
        aria-label="Menu"
        className="fixed right-0 top-0 z-40 flex h-full w-64 max-w-[80vw] flex-col gap-1 border-l border-line bg-card p-4 shadow-lg"
      >
        <p className="mb-2 px-3 font-semibold text-ink">Menu</p>

        <div className="flex flex-col gap-1 overflow-y-auto">
          {links.map((l) => (
            <AppLink key={l.href} href={l.href} prefetch={false} className={rowClass}>
              {l.label}
            </AppLink>
          ))}
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
    </details>
  );
}
