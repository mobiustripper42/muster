import type { ReactNode } from "react";
import type { Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { RegisterSW } from "../components/ui/register-sw";

// IBM Plex (the mockups' faces), vendored under `app/fonts/` and loaded from disk. Exposed as CSS
// variables the @theme tokens bind to.
//
// **These used to come from `next/font/google`, and the comment here said "no external request".**
// That was true of the browser and false of the builder: the Google loader downloads the `.woff2`
// files from `fonts.gstatic.com` DURING `next build` and self-hosts what it downloaded. So the
// network tab looked clean either way and the dependency was invisible until a build failed on it
// — which one did (#731, PR #727: five font URLs retried three times each, then `NextFontError`,
// on a diff that had nothing to do with fonts). Vercel's production build carried the same risk.
//
// The files are the exact `latin` subset Google served, so the rendered faces are unchanged; what
// changed is that nothing fetches them again. The trade is that a future IBM Plex revision now
// needs a deliberate re-fetch instead of arriving silently, which is the direction worth having.
//
// **Adding a weight means adding a file.** A browser synthesizes a face it hasn't got rather than
// refusing, so a `font-light` with no 300 vendored renders subtly wrong and reports nothing.
// `app/fonts.test.ts` reads the `src` lists below and fails the gate on either half of that.
const plexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap", // what next/font/google defaulted to; stated rather than inherited
});
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
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
