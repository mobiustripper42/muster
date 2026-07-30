import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Read straight from package.json, NOT process.env.npm_package_version — the env
// var is only set when the build runs via `npm run build`; Vercel's build command
// (`next build --webpack`) bypasses npm, so the version came through blank and the
// <VersionTag /> rendered nothing in prod. Reading the file is invocation-independent.
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

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
  // Hide the dev-tools badge when the e2e harness is driving the app. CI runs the suite against
  // `next dev` (playwright.config.ts — no dev lock there, and skipping the build keeps the job
  // fast), and the badge is a fixed bottom-left overlay that can expand over page content. It
  // ate a `weekday` checkbox click at 375px in add-ons and offering-catalog: a `sr-only` input
  // whose position had shifted under the badge after the root font size changed. The tests were
  // right, the app was fine, and the thing in the way was framework chrome that has no business
  // being in the viewport during a test run.
  //
  // Keyed off E2E, set by the harness's webServer only — a normal `npm run dev` keeps the badge.
  ...(process.env.E2E === "1" ? { devIndicators: false as const } : {}),
  // Forward package.json's version to the client as NEXT_PUBLIC_APP_VERSION so the
  // <VersionTag /> corner stamp can render it (the NEXT_PUBLIC_ prefix is what gets
  // it into client trees — without it the tag renders blank). Build-time only; the
  // commit SHA rides Vercel's own NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA.
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // The e2e prod-server path (playwright.config.ts `E2E_PROD`) builds into its own
  // output dir so `next build` never writes into the `.next` the operator's live
  // `next dev` is actively reading — that shared-manifest corruption is exactly the
  // coexistence footgun the prod-server switch exists to avoid. Only the e2e build
  // subprocess sets E2E_PROD; a normal `next dev`/`next build`/Vercel build sees `.next`.
  distDir:
    process.env.E2E_PROD === "1" || process.env.E2E_PROD === "true"
      ? ".next-e2e"
      : ".next",
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
