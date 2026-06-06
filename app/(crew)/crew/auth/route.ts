import { type NextRequest, NextResponse } from "next/server";
import { verifyMagicLink } from "@core/auth/magic-link.js";
import { buildSessionCookie } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";

/**
 * Magic-link landing (SPEC §2.6, DEC-010). The link a crew member taps lands
 * here: `/crew/auth?t=<secret>`. We verify-and-consume the one-time token, and on
 * success mint the session cookie and drop them on /crew. No password, no form —
 * the tap IS the login. The cookie is set on the redirect response directly (not
 * via next/headers) so it survives the redirect.
 *
 * Redirects use a RELATIVE `Location` (`/crew`) rather than an absolute URL built
 * from `req.nextUrl.origin` — in Next's dev server that origin is the bind
 * address (localhost), not the Host the client actually used (e.g. a Tailscale
 * host), which would bounce the user to the wrong origin. A relative Location is
 * resolved by the browser against the host it's on, so it's correct everywhere.
 */
function redirectTo(path: string, cookie?: ReturnType<typeof buildSessionCookie>) {
  const res = new NextResponse(null, { status: 307, headers: { Location: path } });
  if (cookie) res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("t");
  const fail = (reason: string) => redirectTo(`/crew?auth=${reason}`);

  if (!secret) return fail("missing");

  let result;
  try {
    result = await verifyMagicLink(getRepo(), secret, { now: new Date() });
  } catch {
    return fail("error"); // DB unreachable, etc.
  }
  if (!result.ok) return fail(result.reason);

  return redirectTo("/crew", buildSessionCookie(result.subject));
}
