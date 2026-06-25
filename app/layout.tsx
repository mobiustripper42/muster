import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

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

export const metadata = {
  title: "Muster",
  description: "Crew engine for small-passenger-vessel operators",
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
      </body>
    </html>
  );
}
