"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppLink } from "../ui/app-link";
import { SubmitButton } from "../ui/submit-button";
import { switchToCrew } from "../../app/lib/switch-actions";
import { visibleAdminLinks } from "../../app/lib/admin-links";

/**
 * Persistent admin nav (#174) — the frame that stitches the per-screen admin
 * surfaces into one app. Wayfinding, not a redesign: existing tokens only (BRAND /
 * DEC-021), one client island.
 *
 * Responsive (the operator runs the pilot from a phone): on desktop the links
 * sit inline; on mobile they collapse to a **hamburger on the right** that opens a
 * **slide-in drawer** from the right edge (backdrop dim, closes on link-tap /
 * backdrop-tap / Escape). The active link is highlighted in both via `usePathname`.
 * The original "no hamburger" AC was revised by the operator (DEC-021 stays — no new
 * colors). Links the BUILT surfaces (9.12 added Messages); the rest are one line
 * each later.
 */

export function AdminNav({
  tenant,
  dateLabel,
  messaging,
  reservations,
}: {
  /** Tenant display name + today's VESSEL-LOCAL date (9.8) — computed by the
   *  server layout (DEC-032: never the viewer's clock) and passed down. */
  tenant: string;
  dateLabel: string;
  /** Messaging feature on? (#389) — resolved server-side (this is a client
   *  component, so the env flag can't be read here) and passed down. Drops the
   *  Messages nav item when off. */
  messaging: boolean;
  /** Reservations feature on? (DEC-111, #586) — same server-side resolution. Drops the six
   *  reservations-era entries when off, which is most of the bar's width. */
  reservations: boolean;
}) {
  const links = visibleAdminLinks({ messaging, reservations });
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // Close on navigation (a tapped link changes the path)…
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  // …and on Escape; move focus into the drawer when it opens.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <nav aria-label="Admin" className="sticky top-0 z-20 border-b border-line bg-card">
      {/* Wider than the `max-w-3xl` page shell on purpose (#586). The nav is chrome, not reading
          copy: borrowing the body-copy width capped nav content at 768px no matter how wide the
          monitor was, so a 1440px screen had ~830px of empty white bar on either side while the
          links fought for room in the middle. That manufactured the collision, and no bigger
          display could ever relieve it. */}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <AppLink href="/admin" className="shrink-0 font-semibold text-ink">
            Muster
          </AppLink>
          {/* Whose board, which day (9.8) — vessel-local, tertiary ink. */}
          <span className="truncate text-xs text-faint">
            {tenant} · {dateLabel}
          </span>
          {/* Switch down to the crew app (DEC-093) — the admin is also crew.
              Always safe (de-escalation); gated server-side. */}
          <form action={switchToCrew} className="shrink-0">
            <SubmitButton className="whitespace-nowrap text-xs text-muted underline hover:text-ink">
              Crew view
            </SubmitButton>
          </form>
        </div>

        {/* Desktop: inline links. `gap-4` + nowrap — 12.8 added a ninth link (Offerings)
            and gap-5 let "Crew view"/a hyphenated label wrap, busting the 52px height
            budget the two-pane shell subtracts (#253, pinned by admin-nav.spec).

            Inline only at `xl` (#586). The first attempt at this let the row scroll instead of
            overflow, which measured worse than the bug it replaced: at 1440px four links sat
            outside a 443px box with the scrollbar hidden, so the bar rendered as a tidy,
            complete-looking 8 items and silently swallowed Add-ons, Vessels, Locations and
            Blocks. The original collision was at least self-evidently broken — it got reported
            within one usage cycle. A clean-looking bar that is missing navigation does not.

            Below `xl` the links live in the hamburger drawer, which holds all of them. That is
            crude — with the default flag set there are six links and they would fit at 1024 —
            but a fixed breakpoint cannot know the link count, and every alternative either
            clips silently or paints over the brand again.

            Grouping is what actually fixes this: twelve peers is not a hierarchy and roughly
            half are edited once a season. Direction 2 in #586, its own design pass. */}
        <div className="hidden shrink-0 items-center gap-4 text-sm xl:flex">
          {links.map((l) => (
            <AppLink
              key={l.href}
              href={l.href}              aria-current={isActive(l.href) ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap ${isActive(l.href) ? "font-semibold text-accent" : "text-muted"}`}
            >
              {l.label}
            </AppLink>
          ))}
        </div>

        {/* Mobile: hamburger on the right. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="admin-drawer"
          className="-mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-ink xl:hidden"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h14M4 11h14M4 16h14" />
          </svg>
        </button>
      </div>

      {/* Mobile slide-in drawer + backdrop — always mounted (so it animates both
          ways), mobile-only, and inert while closed so its links leave the tab order. */}
      <div className="xl:hidden">
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className={`fixed inset-0 z-30 bg-ink/40 transition-opacity duration-200 ${
            open ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />
        <div
          id="admin-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          inert={!open}
          className={`fixed right-0 top-0 z-40 flex h-full w-64 max-w-[80vw] flex-col gap-1 border-l border-line bg-card p-4 shadow-lg transition-transform duration-200 ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-ink">Menu</span>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>
          {links.map((l) => (
            <AppLink
              key={l.href}
              href={l.href}              aria-current={isActive(l.href) ? "page" : undefined}
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-base ${
                isActive(l.href) ? "bg-bg font-semibold text-accent" : "text-ink"
              }`}
            >
              {l.label}
            </AppLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
