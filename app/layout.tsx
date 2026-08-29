import type { ReactNode } from "react";
import type { Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "../components/ui/register-sw";

// IBM Plex (the mockups' faces). next/font self-hosts them — no layout shift,
// no external request. Exposed as CSS variables the @theme tokens bind to.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

/**
 * Which environment this build is, in words — the tab-title half of the coloured top-edge line
 * below. Red line = local dev, yellow = Vercel preview, nothing = production.
 *
 * The line tells you while you're looking at the page; the title tells you from the tab strip,
 * which is where you are when prod and a branch are both open and you click the wrong one.
 *
 * PREFIXED, not suffixed: a tab is a few characters wide with a dozen open and it truncates from
 * the right, so anything after "Muster" is the first thing to disappear — exactly when you have
 * enough tabs open to need it.
 *
 * Same `NODE_ENV` / `VERCEL_ENV` pair the line and the DEC-057 dev-link gate key off, so all
 * three agree by construction rather than by remembering to change them together.
 */
const TITLE =
  process.env.NODE_ENV === "development"
    ? "Dev-Muster"
    : process.env.VERCEL_ENV === "preview"
      ? "Pre-Muster"
      : "Muster";

export const metadata = {
  title: TITLE,
  description: "Reservation and operations system for small-passenger-vessel operators",
  applicationName: "Muster",
  // Installable to a phone home screen (Phase 10.6). app/manifest.ts is
  // auto-linked; these give iOS its touch icon + standalone chrome.
  appleWebApp: { capable: true, title: TITLE, statusBarStyle: "default" as const },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

/** Mobile-first: the crew app is a co-equal native-feeling surface (dual form
 *  factor), so the root viewport + brand theme-color apply app-wide. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f5d86",
};

/** Root layout — the single shell over both surface groups (admin + crew). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        {/* Environment tell (server-rendered, no client JS): a 4px line pinned to
            the top edge — red on local dev, yellow on a Vercel preview, nothing in
            production. Keys off the same VERCEL_ENV the dev-link gate uses (DEC-057).
            The two conditions are mutually exclusive: Vercel sets NODE_ENV=production
            on both preview and prod builds, so `development` only matches local. */}
        {process.env.NODE_ENV === "development" && (
          <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-1 bg-red-600" />
        )}
        {process.env.VERCEL_ENV === "preview" && (
          <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-1 bg-yellow-400" />
        )}
        {children}
        {/* Registers the minimal service worker (#391) — required for the Android
            Chrome install prompt. Client-only; inert with JS off. */}
        <RegisterSW />
      </body>
    </html>
  );
}
