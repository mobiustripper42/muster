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
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    },
  },
};

export default nextConfig;
