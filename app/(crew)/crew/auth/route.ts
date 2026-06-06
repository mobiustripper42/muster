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
 */
export async function GET(req: NextRequest) {
  const base = req.nextUrl.origin;
  const secret = req.nextUrl.searchParams.get("t");
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/crew?auth=${reason}`, base));

  if (!secret) return fail("missing");

  let result;
  try {
    result = await verifyMagicLink(getRepo(), secret, { now: new Date() });
  } catch {
    return fail("error"); // DB unreachable, etc.
  }
  if (!result.ok) return fail(result.reason);

  const res = NextResponse.redirect(new URL("/crew", base));
  const { name, value, options } = buildSessionCookie(result.subject);
  res.cookies.set(name, value, options);
  return res;
}
