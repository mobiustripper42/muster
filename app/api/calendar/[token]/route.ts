import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hashSecret } from "@core/auth/magic-link.js";
import { buildCalendarFeed, renderCalendar } from "@core/crewapp/calendar-feed.js";
import { getRepo } from "../../../lib/repo";
import { baseUrl } from "../../../lib/base-url";
import { TENANT_NAME } from "../../../lib/tenant";

/**
 * The crew iCal feed (#355, DEC-098) — an UNAUTHENTICATED public endpoint whose
 * bearer credential IS the token in the path. A calendar client (Google/Apple) sends
 * no session cookie; the ~256-bit token is the whole auth story, which is why no
 * rate-limiter is needed (enumeration is infeasible). We look the feed up by the
 * HASH of the presented token (only the hash is stored — DEC-098) and 404 on a
 * miss/revoked token — a generic response, no oracle (the DEC-081 posture).
 *
 * NEVER log the token or the full URL.
 */
export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404 });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token: rawParam } = await ctx.params;
  // Some Apple clients key on the `.ics` extension — accept and strip it.
  const token = rawParam.replace(/\.ics$/i, "");
  if (!token) return notFound();

  const tokenHash = hashSecret(token);
  const repo = getRepo();

  const feedRow = await repo.getCalendarFeedByTokenHash(tokenHash);
  if (!feedRow) return notFound();

  const now = new Date();
  const data = await buildCalendarFeed(repo, feedRow.crewMemberId, now);
  if (!data) return notFound(); // the crew row is gone (deprovisioned)

  const ics = renderCalendar(data, {
    calendarName: `${TENANT_NAME} — ${data.crewName}`,
    appBaseUrl: baseUrl(req),
    now,
  });

  // Best-effort "last synced" stamp — a write hiccup must never fail the feed.
  void repo.touchCalendarFeedPoll(tokenHash, now.toISOString()).catch(() => {});

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // Let a client re-fetch often; this feed is cheap and meant to stay current.
      "cache-control": "no-cache, max-age=0",
    },
  });
}
