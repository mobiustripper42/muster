import type { NextConfig } from "next";

/**
 * Next.js config (DEC-020, M4). Deliberately minimal — the stack is Next (App
 * Router) on Vercel; persistence and auth live behind the service layer + the
 * Repository port, not in framework config.
 *
 * `extensionAlias` lets the bundler resolve the domain core's NodeNext `.js`
 * import specifiers to their `.ts` sources. The core under src/ stays correct
 * Node-ESM (explicit `.js` extensions — required by NodeNext + verbatimModule-
 * Syntax, and by Vitest); this mapping is what lets Next consume it directly via
 * the `@core/*` alias without a separate compile step.
 *
 * Build/dev run on **webpack** (`--webpack`), not Turbopack: `extensionAlias` is
 * a webpack resolve feature, and Turbopack does not apply `.js`→`.ts` mapping to
 * aliased paths — so the core's `.js` specifiers don't resolve under Turbopack.
 * Revisit when Turbopack supports extension aliasing; until then webpack is the
 * correct resolver for a NodeNext core consumed directly.
 */
const nextConfig: NextConfig = {
  // The dev server is reached over Tailscale at `mill-dev:3000`, NOT localhost
  // (docs/RUNNING.md). Next 15+/16 refuses its internal dev endpoints — the HMR
  // WebSocket included — for any origin not listed here, which silently breaks
  // hot-reload AND client hydration when the app is opened via this host. The
  // breakage was invisible until the first `'use client'` component (the outbox
  // Send island, DEC-030) needed hydration to work. Dev-only; the Vercel build
  // is unaffected.
  allowedDevOrigins: ["mill-dev"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    },
    // The /admin/import xlsx upload (5.4a) posts a file through a Server Action;
    // Next caps Server Action bodies at 1MB by default, which would clip the
    // upload before our own 5MB guard runs. Set just above the app cap so the
    // app's check is the binding one with a clean message (DEC-037).
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
