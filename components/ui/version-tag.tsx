/**
 * Build-time version stamp — the lower-right corner tag (Sailbook-style), mounted
 * only on the signed-in menu surfaces (`/crew`, `/admin`), not every page.
 *
 * Reads build-time env, inlined at build (no client JS):
 *  - `NEXT_PUBLIC_APP_VERSION` — forwarded from `package.json` version via
 *    `next.config.ts`. Without the `NEXT_PUBLIC_` prefix it never reaches the
 *    browser and this renders nothing.
 *  - `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` — Vercel sets it automatically; absent in
 *    local `npm run dev`, so the short hash is prod-only (intentional).
 *
 * `pointer-events-none` so the fixed corner can never swallow a tap on the content
 * beneath it; `aria-hidden` because it's ambient chrome, not page content.
 */
export function VersionTag() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  if (!version) return null;
  const sha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
  const label = sha ? `v${version} (${sha.slice(0, 7)})` : `v${version}`;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none fixed bottom-2 right-3 z-10 select-none text-xs text-muted"
    >
      {label}
    </span>
  );
}
