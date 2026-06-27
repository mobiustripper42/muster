"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Persistent admin nav (#174) — the frame that stitches the per-screen admin
 * surfaces into one app. Each surface was mocked in isolation, so the menu (the one
 * piece of UI that lives BETWEEN screens) was never surfaced by the per-screen
 * design process; the screens read "under-baked" because nothing connects them.
 * This is **wayfinding, not a redesign**: existing tokens only (BRAND / DEC-021), no
 * new colors, and no hamburger for four links.
 *
 * The ONE client island on the admin surfaces' chrome — `usePathname` for the active
 * highlight (the same one-island pattern as the crew app). The (admin) layout renders
 * it server-side, only for an admin subject. Links only the four BUILT surfaces;
 * roster / event-admin / shift-builder are one line each when they land.
 */
const LINKS = [
  { href: "/admin/at-risk", label: "At-Risk" },
  { href: "/admin/outbox", label: "Outbox" },
  { href: "/admin/import", label: "Import" },
  { href: "/admin/shifts", label: "Shifts" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Admin" className="sticky top-0 z-10 border-b border-line bg-card">
      {/* max-w-3xl + px-4 align the bar to the 3xl admin Shell width. */}
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
        <Link href="/admin" className="shrink-0 font-semibold text-ink">
          Muster
        </Link>
        <div className="flex items-center gap-3 text-sm sm:gap-5">
          {LINKS.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={active ? "font-semibold text-accent" : "text-muted"}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
