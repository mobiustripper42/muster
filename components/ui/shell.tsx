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
}: {
  children: React.ReactNode;
  width?: keyof typeof widths;
}) {
  return (
    <main
      className={`mx-auto flex min-h-screen w-full ${widths[width]} flex-col gap-4 px-4 py-6`}
    >
      {children}
    </main>
  );
}
