import { type NextRequest, NextResponse } from "next/server";
import { peekLastLoginCode } from "../../../lib/auth-delivery";
import { isProdDeploy, selfServeEnabled } from "../../../lib/flags";

/**
 * DEV-ONLY login-code echo (DEC-080). The code-login store keeps only the code's
 * HASH, so a black-box test (or a dev by hand) can't read a minted code back.
 * This returns the last code delivered to an email — the parallel to the dev-link
 * issuer for the code flow, with the SAME gating: hard-404 on any production
 * deploy (Vercel prod or self-hosted), and only live when self-serve is on.
 *
 * `VERCEL_ENV` is the primary gate (Vercel sets NODE_ENV=production on previews
 * too); the NODE_ENV fallback re-closes it on a self-hosted prod. Never live in
 * production on any host.
 */
export async function GET(req: NextRequest) {
  // Same gate the echo populate uses (auth-delivery.ts): live on preview + local,
  // 404 on any prod deploy, and only when self-serve is on.
  if (isProdDeploy() || !selfServeEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }
  const email = req.nextUrl.searchParams.get("email");
  if (!email) {
    return new NextResponse("pass ?email=<crew email>", { status: 400 });
  }
  const code = peekLastLoginCode(email);
  if (!code) return new NextResponse(null, { status: 204 });
  return new NextResponse(code, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
