import { qrPath } from "./qr-path";

/**
 * A departure's signing link as a QR code (Phase 18.5b; surfaces §C2; DEC-191) — drawn on the
 * server, so it is in the page the moment the page loads and still shows when the dock signal drops.
 * No `"use client"`, and only server components import it, so `uqr` never ships to the browser.
 * Black on white whatever the theme: scanners read dark-on-light. Its label is the link itself,
 * which is what a screen reader, and the e2e suite, can check.
 */
export function TripQr({ url, className }: { url: string; className?: string }) {
  const { size, d } = qrPath(url);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`QR code for ${url}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
