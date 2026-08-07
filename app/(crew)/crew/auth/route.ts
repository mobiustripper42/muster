import { type NextRequest, NextResponse } from "next/server";
import { peekMagicLink, verifyMagicLink } from "@core/auth/magic-link.js";
import { buildSessionCookie, readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * Magic-link landing (SPEC §2.6, DEC-010, DEC-030). The link a crew member taps
 * lands here: `/crew/auth?t=<secret>`.
 *
 * PREFETCH-SAFE in two steps (DEC-030): relay links travel through
 * iMessage/Android SMS, whose link-preview bots GET the URL before the human
 * taps — a GET that consumed the single-use token would burn every relayed
 * link in transit. So:
 *   GET  → verify WITHOUT consuming (`peekMagicLink`, pure reads) and render a
 *          "Tap to sign in" button. A preview bot fetching this page changes
 *          nothing; it can render it a hundred times.
 *   POST → the human's explicit tap: verify-and-CONSUME (single-use CAS), mint
 *          the session cookie, redirect to their world. Bots don't POST forms.
 *
 * The cookie is set on the redirect response directly (not via next/headers)
 * so it survives the redirect. Redirects use a RELATIVE `Location` — in Next's
 * dev server `req.nextUrl.origin` is the bind address (localhost), not the
 * Host the client used (e.g. a Tailscale host); the browser resolves a
 * relative Location against the host it's on, correct everywhere. The POST
 * redirect is 303 (See Other) so the browser follows with a GET.
 */
function redirectTo(
  path: string,
  status: 303 | 307 = 307,
  cookie?: ReturnType<typeof buildSessionCookie>,
) {
  const res = new NextResponse(null, { status, headers: { Location: path } });
  if (cookie) res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/**
 * Post-auth crew landing (DEC-073 thread deep-link). A doorbell-ring link carries
 * `&thread=<threadId>` so the crew member lands IN the thread they were rung about
 * (artifact §9). The threadId is a NAV HINT, not an authz grant — the thread page
 * independently membership-gates (DEC-052/071), so a tampered value just navigates
 * to a page that refuses. Still: validate to a conservative id shape and
 * `encodeURIComponent` into the FIXED `/crew/threads/` prefix — the param is never
 * used as a raw URL, so it can't carry `//`, `..`, or a scheme. Anything off → home.
 */
function crewLanding(thread: string | null): string {
  if (!thread || !/^[A-Za-z0-9:_-]{1,200}$/.test(thread)) return "/crew";
  return `/crew/threads/${encodeURIComponent(thread)}`;
}

/** The tap-to-sign-in interstitial — same visual family as the dev-link page. The
 *  `thread` hint rides as a hidden field so it survives the GET→POST (the query
 *  string doesn't reach the form submit). */
function signInPage(secret: string, thread: string | null): NextResponse {
  const threadField = thread
    ? `\n    <input type="hidden" name="thread" value="${esc(thread)}">`
    : "";
  const html = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Muster — sign in</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;
    place-items:center;background:#0f1115;color:#e6e8eb}
  .card{width:min(92vw,420px);text-align:center;padding:24px}
  .brand{font:600 13px/1.4 ui-monospace,monospace;color:#9aa3af;margin-bottom:16px}
  button{display:block;width:100%;min-height:52px;border:0;border-radius:12px;
    background:#16a34a;color:#fff;font:600 16px system-ui;cursor:pointer}
  .note{margin-top:12px;font:12px system-ui;color:#6b7280}
</style>
<div class="card">
  <div class="brand">Muster</div>
  <form method="post" action="/crew/auth">
    <input type="hidden" name="t" value="${esc(secret)}">${threadField}
    <button type="submit">Tap to sign in →</button>
  </form>
  <div class="note">One tap signs you in on this device.</div>
</div>`;
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("t");
  const fail = (reason: string) => redirectTo(`/crew?auth=${reason}`);

  if (!secret) return fail("missing");

  // Peek only — a GET must never consume (DEC-030 prefetch rule).
  let result;
  try {
    result = await peekMagicLink(getRepo(), secret, { now: new Date() });
  } catch {
    return fail("error"); // DB unreachable, etc.
  }
  if (!result.ok) return fail(result.reason);

  const thread = req.nextUrl.searchParams.get("thread");

  // ALREADY SIGNED IN (#696) — skip the tap. The interstitial above defends against a client
  // with NO session (a preview bot); it has nothing to say to a crew member whose browser is
  // already carrying a valid cookie for the very subject this token names. They were made to
  // tap on every ask, every doorbell ring, every notice.
  //
  // MATCH the subject, don't just check presence. Signed in as someone else — a shared phone,
  // or the operator opening a crew member's link — must still see the button: auto-redirecting
  // would drop them into the wrong person's world AND look like it worked.
  //
  // The token is deliberately NOT consumed here. A GET that writes is exactly what DEC-030's
  // prefetch rule exists to prevent, and a browser prefetching WITH cookies would burn a link
  // the human hasn't used yet — leaving them a dead link that looks fine if their session
  // lapsed in between. Nothing is gained by consuming: whoever holds this phone already holds
  // the session cookie that makes the token redundant.
  const session = await readSubject();
  if (
    session &&
    session.kind === result.subject.kind &&
    String(session.id) === String(result.subject.id)
  ) {
    return redirectTo(session.kind === "admin" ? "/admin/at-risk" : crewLanding(thread));
  }

  return signInPage(secret, thread);
}

export async function POST(req: NextRequest) {
  const fail = (reason: string) => redirectTo(`/crew?auth=${reason}`, 303);

  let secret: string;
  let thread: string | null = null;
  try {
    const form = await req.formData();
    secret = String(form.get("t") ?? "");
    thread = form.get("thread") ? String(form.get("thread")) : null;
  } catch {
    return fail("missing");
  }
  if (!secret) return fail("missing");

  // The explicit tap: consume the one-time token (single-use CAS).
  let result;
  try {
    result = await verifyMagicLink(getRepo(), secret, { now: new Date() });
  } catch {
    return fail("error");
  }
  if (!result.ok) return fail(result.reason);

  // Land each subject on their world: the operator → the At-Risk board (SPEC §2.5);
  // crew → the crew app, OR straight into the thread a doorbell ring named (DEC-073,
  // crew branch only — `thread` is validated + path-built, never a raw redirect).
  const home =
    result.subject.kind === "admin" ? "/admin/at-risk" : crewLanding(thread);
  return redirectTo(home, 303, buildSessionCookie(result.subject));
}
