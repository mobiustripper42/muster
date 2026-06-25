import { type NextRequest, NextResponse } from "next/server";
import { issueMagicLink, randomSecret } from "@core/auth/magic-link.js";
import { baseUrl } from "../../../lib/base-url";
import { getRepo } from "../../../lib/repo";

/**
 * DEV-ONLY magic-link issuer. Crew don't self-register and the operator-send path
 * isn't built yet (1.5b+), so this is how you exercise the landing flow by hand:
 * `GET /crew/dev-link?crew=<crewMemberId>` → a clickable link, or
 * `GET /crew/dev-link?admin=<handle>` → an operator (Spink) link for the admin
 * surfaces. In real life the link leaves via the channel port
 * (fake/SMS/Telegram). Hard-disabled in prod, live on previews + local (DEC-057).
 *
 * Disabled on every PRODUCTION deploy, host-agnostic; live on previews + local
 * (DEC-057). `VERCEL_ENV` is the primary gate because Vercel sets
 * `NODE_ENV=production` on preview deploys too — so a `NODE_ENV`-only gate 404s
 * previews, killing the only way to sign in (crew OR admin) and smoke-test a
 * preview before promoting. `VERCEL_ENV` is `"production"` only on the real prod
 * deploy, `"preview"` on previews, undefined off-Vercel. The `NODE_ENV` fallback
 * re-closes the gate on a self-hosted prod (`next start` / Docker) where
 * `VERCEL_ENV` is absent — so the minter never goes live in production on ANY host.
 *
 * Mint-into-a-preview is contained two ways: the preview's isolated Neon branch DB
 * (a clone, never prod), and `SESSION_SECRET` must be set on the Preview env or the
 * mint throws (auth.ts) — no forgeable session from a bare preview URL. Pair with
 * `APP_BASE_URL` scoped to Production only so the minted link's host resolves to the
 * preview, not prod (DEC-057, base-url.ts).
 */
export async function GET(req: NextRequest) {
  // 404 on any prod deploy: Vercel prod (VERCEL_ENV) OR self-hosted prod
  // (no VERCEL_ENV, NODE_ENV=production). Live only on Vercel previews + local dev.
  const isProdDeploy =
    process.env.VERCEL_ENV === "production" ||
    (!process.env.VERCEL_ENV && process.env.NODE_ENV === "production");
  if (isProdDeploy) {
    return new NextResponse("Not found", { status: 404 });
  }
  const crew = req.nextUrl.searchParams.get("crew");
  const admin = req.nextUrl.searchParams.get("admin");
  if (!crew && !admin) {
    return new NextResponse("pass ?crew=<crewMemberId> or ?admin=<handle>", {
      status: 400,
    });
  }
  const subject = crew
    ? { subjectKind: "crew" as const, subjectId: crew }
    : { subjectKind: "admin" as const, subjectId: admin! };
  const { secret } = await issueMagicLink(
    getRepo(),
    { ...subject, ttlMs: 15 * 60_000 },
    { now: new Date(), mintSecret: randomSecret },
  );
  const link = `${baseUrl(req)}/crew/auth?t=${secret}`;
  const who = crew ? `crew · ${crew}` : `admin · ${admin}`;
  // HTML over JSON: this is a hand-driven dev tool. The BUTTON posts straight to
  // the consume endpoint (one tap signs you in here — the dev shortcut); the URL
  // below is the production-shaped link you'd actually text a crew member, which
  // lands on the prefetch-safe GET interstitial (DEC-030). Escape the
  // query-supplied subject — it's reflected into markup, dev-only or not.
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  const html = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Magic link</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;
    place-items:center;background:#0f1115;color:#e6e8eb}
  .card{width:min(92vw,420px);text-align:center;padding:24px}
  .who{font:600 13px/1.4 ui-monospace,monospace;color:#9aa3af;margin-bottom:16px}
  .btn{display:block;width:100%;min-height:52px;border:0;border-radius:12px;
    background:#16a34a;color:#fff;font:600 16px system-ui;cursor:pointer}
  .url{margin-top:16px;font:12px/1.5 ui-monospace,monospace;color:#6b7280;
    word-break:break-all;user-select:all}
  .note{margin-top:12px;font:12px system-ui;color:#6b7280}
</style>
<div class="card">
  <div class="who">${esc(who)}</div>
  <form method="post" action="/crew/auth">
    <input type="hidden" name="t" value="${esc(secret)}">
    <button class="btn" type="submit">Tap to sign in →</button>
  </form>
  <div class="url">${esc(link)}</div>
  <div class="note">Dev only · single-use · expires in 15 min</div>
</div>`;
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
