import { type NextRequest, NextResponse } from "next/server";
import { issueMagicLink, randomSecret } from "@core/auth/magic-link.js";
import { baseUrl } from "../../../lib/base-url";
import { getRepo } from "../../../lib/repo";

/**
 * DEV-ONLY magic-link issuer. Crew don't self-register and the operator-send path
 * isn't built yet (1.5b+), so this is how you exercise the landing flow by hand:
 * `GET /crew/dev-link?crew=<crewMemberId>` → a clickable link. In real life
 * the link leaves via the channel port (fake/SMS/Telegram). Hard-disabled in prod.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  const crew = req.nextUrl.searchParams.get("crew");
  if (!crew) {
    return new NextResponse("pass ?crew=<crewMemberId>", { status: 400 });
  }
  const { secret } = await issueMagicLink(
    getRepo(),
    { subjectKind: "crew", subjectId: crew, ttlMs: 15 * 60_000 },
    { now: new Date(), mintSecret: randomSecret },
  );
  const link = `${baseUrl(req)}/crew/auth?t=${secret}`;
  return NextResponse.json({ link });
}
