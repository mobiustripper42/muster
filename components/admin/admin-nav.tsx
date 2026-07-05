"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NavSpinner } from "../ui/nav-spinner";

/**
 * Persistent admin nav (#174) — the frame that stitches the per-screen admin
 * surfaces into one app. Wayfinding, not a redesign: existing tokens only (BRAND /
 * DEC-021), one client island.
 *
 * Responsive (the operator runs the pilot from a phone): on desktop the four links
 * sit inline; on mobile they collapse to a **hamburger on the right** that opens a
 * **slide-in drawer** from the right edge (backdrop dim, closes on link-tap /
 * backdrop-tap / Escape). The active link is highlighted in both via `usePathname`.
 * The original "no hamburger" AC was revised by the operator (DEC-021 stays — no new
 * colors). Links only the four BUILT surfaces; the rest are one line each later.
 */
const LINKS = [
  { href: "/admin/at-risk", label: "At-Risk" },
  { href: "/admin/outbox", label: "Outbox" },
  { href: "/admin/import", label: "Import" },
  { href: "/admin/shifts", label: "Shifts" },
] as const;

export function AdminNav({
  tenant,
  dateLabel,
}: {
  /** Tenant display name + today's VESSEL-LOCAL date (9.8) — computed by the
   *  server layout (DEC-032: never the viewer's clock) and passed down. */
  tenant: string;
  dateLabel: string;
}) {
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
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <Link href="/admin" className="shrink-0 font-semibold text-ink">
            Muster
          </Link>
          {/* Whose board, which day (9.8) — vessel-local, tertiary ink. */}
          <span className="truncate text-xs text-faint">
            {tenant} · {dateLabel}
          </span>
        </span>

        {/* Desktop: inline links. */}
        <div className="hidden items-center gap-5 text-sm sm:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 ${isActive(l.href) ? "font-semibold text-accent" : "text-muted"}`}
            >
              {l.label}
              <NavSpinner className="text-accent" />
            </Link>
          ))}
        </div>

        {/* Mobile: hamburger on the right. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="admin-drawer"
          className="-mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-ink sm:hidden"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h14M4 11h14M4 16h14" />
          </svg>
        </button>
      </div>

      {/* Mobile slide-in drawer + backdrop — always mounted (so it animates both
          ways), mobile-only, and inert while closed so its links leave the tab order. */}
      <div className="sm:hidden">
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
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-base ${
                isActive(l.href) ? "bg-bg font-semibold text-accent" : "text-ink"
              }`}
            >
              {l.label}
              <NavSpinner className="text-accent" />
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
