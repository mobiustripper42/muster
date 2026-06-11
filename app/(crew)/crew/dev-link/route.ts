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
 * (fake/SMS/Telegram). Hard-disabled in prod.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
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
  // HTML over JSON: this is a hand-driven dev tool, so render a tappable button
  // instead of a payload you'd have to copy out. Escape the query-supplied
  // subject — it's reflected into markup, dev-only or not. Link is single-use.
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
  a.btn{display:block;min-height:52px;border-radius:12px;background:#16a34a;
    color:#fff;font:600 16px/52px system-ui;text-decoration:none}
  .url{margin-top:16px;font:12px/1.5 ui-monospace,monospace;color:#6b7280;
    word-break:break-all;user-select:all}
  .note{margin-top:12px;font:12px system-ui;color:#6b7280}
</style>
<div class="card">
  <div class="who">${esc(who)}</div>
  <a class="btn" href="${esc(link)}">Tap to sign in →</a>
  <div class="url">${esc(link)}</div>
  <div class="note">Dev only · single-use · expires in 15 min</div>
</div>`;
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
