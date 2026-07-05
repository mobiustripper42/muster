import type React from "react";

/** Width map uses literal class strings so Tailwind's scanner sees them. */
const widths = {
  md: "max-w-md",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  // Two-pane board+cockpit (DEC-085) — the only 6xl surface.
  "6xl": "max-w-6xl",
} as const;

export function Shell({
  children,
  width = "md",
  fill = false,
}: {
  children: React.ReactNode;
  width?: keyof typeof widths;
  /**
   * Viewport-fit mode (#253): on desktop (`lg:`) the shell is bounded to the
   * space below the admin nav so an inner grid can give its columns independent
   * scroll — the WINDOW never scrolls, so opening/switching a pane can't snap the
   * list to the top. No effect below `lg`: mobile stays normal-flow (min-h-screen,
   * window-scrolled, full-screen drill-in). Opt-in; only the two-pane board uses it.
   *
   * The `3.25rem` cutoff is the sticky admin-nav height budget (`admin-nav.tsx`,
   * ~45px today). It's a constant this file can't derive from the nav, so it's
   * pinned by an e2e guard (`admin-nav.spec.ts` — nav height ≤ 52px); a nav that
   * outgrows the budget fails there instead of quietly reopening #253.
   */
  fill?: boolean;
}) {
  return (
    <main
      className={`mx-auto flex min-h-screen w-full ${widths[width]} flex-col gap-4 px-4 py-6 ${
        fill ? "lg:h-[calc(100dvh-3.25rem)] lg:min-h-0" : ""
      }`}
    >
      {children}
    </main>
  );
}
