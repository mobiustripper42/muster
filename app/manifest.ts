import type { MetadataRoute } from "next";

/**
 * Web app manifest (Phase 10.6) — makes Muster installable to a phone home
 * screen so crew get durable re-entry to My Shifts (the "living link" interim,
 * FUTURE_IDEAS; the session-aware root redirect in app/page.tsx already lands an
 * installed crew member on /crew). Served at /manifest.webmanifest; Next injects
 * the <link rel="manifest"> automatically. Icons are the committed PNGs under
 * public/ (scripts/gen-icons.mjs). Colors track --color-accent / --color-bg.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Muster",
    short_name: "Muster",
    description: "Your trips and shift asks, in one place.",
    // Session-aware: app/page.tsx redirects a crew session to /crew (My Shifts),
    // an admin to /admin — so "/" is the right home for either installer.
    start_url: "/",
    display: "standalone",
    background_color: "#eef2f6",
    theme_color: "#2f5d86",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
