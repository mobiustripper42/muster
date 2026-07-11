import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { BackLink } from "../../../../components/ui/back-link";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { FLASH_COOKIE } from "./flash";
import {
  hideCalendarUrl,
  mintCalendarFeed,
  revokeCalendarFeed,
} from "./actions";

/**
 * /crew/calendar (#355, DEC-098) — the crew member's calendar-sync control. Mint a
 * subscribable iCal link; their confirmed shifts then appear in Google/Apple Calendar
 * automatically (push, not pull). The link is shown ONCE at mint (hash-only storage);
 * lost == regenerate (rotates, old link dies), which is also the turn-off lever.
 * Server-rendered, no client JS (DEC-026): every control is a server-action form.
 */

export const dynamic = "force-dynamic";

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** External origin for building the feed URL shown to the crew member. Prefers the
 *  trusted APP_BASE_URL; falls back to the request host for local dev. */
async function origin(): Promise<string> {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export default async function CrewCalendar() {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew");
  const crewId = asId<"CrewMemberId">(subject.id);

  const feed = await getRepo().getCalendarFeedForCrew(crewId);
  const flash = (await cookies()).get(FLASH_COOKIE)?.value;
  const feedUrl = flash ? `${await origin()}/api/calendar/${flash}.ics` : null;

  return (
    <Shell>
      <BackLink href="/crew">Home</BackLink>
      <h1 className="text-lg font-semibold text-ink">Calendar sync</h1>
      <p className="text-sm text-muted">
        Add your confirmed shifts to your phone’s calendar. They appear automatically
        and stay in sync — no need to open Muster to see what’s next.
      </p>

      {feedUrl ? (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-4 shadow-sm">
          <Notice tone="warn">
            Copy this link now — for your security it won’t be shown again. Lost it?
            Just make a new one.
          </Notice>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Your calendar link
            <input
              readOnly
              value={feedUrl}
              aria-label="Your calendar feed link"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-ink"
            />
          </label>
          <p className="text-xs text-muted">
            Add it in <b>Google Calendar</b> (Other calendars → From URL) or{" "}
            <b>Apple Calendar</b> (File → New Calendar Subscription).
          </p>
          <form action={hideCalendarUrl}>
            <SubmitButton className="min-h-[44px] w-full rounded-lg bg-accent px-4 font-semibold text-white">
              I’ve saved it — done
            </SubmitButton>
          </form>
        </div>
      ) : feed ? (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-4 shadow-sm">
          <Notice tone="ok">
            Your calendar sync is on (since {fmtWhen(feed.createdAt)}).
          </Notice>
          {feed.lastPolledAt && (
            <p className="text-xs text-muted">
              Last synced {fmtWhen(feed.lastPolledAt)}.
            </p>
          )}
          <p className="text-xs text-muted">
            The link is only shown once, when you create it. Lost it? Make a new one —
            the old link stops working.
          </p>
          <form action={mintCalendarFeed}>
            <SubmitButton className="min-h-[44px] w-full rounded-lg border border-accent bg-card px-4 font-semibold text-accent">
              Make a new link
            </SubmitButton>
          </form>
          <form action={revokeCalendarFeed}>
            <SubmitButton className="min-h-[44px] w-full rounded-lg border border-bad-line bg-card px-4 font-semibold text-bad">
              Turn off calendar sync
            </SubmitButton>
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-4 shadow-sm">
          <p className="text-sm text-muted">
            You don’t have a calendar link yet. Create one, then add it to your
            calendar app — that’s it.
          </p>
          <form action={mintCalendarFeed}>
            <SubmitButton className="min-h-[44px] w-full rounded-lg bg-accent px-4 font-semibold text-white">
              Create my calendar link
            </SubmitButton>
          </form>
        </div>
      )}

      <VersionTag />
    </Shell>
  );
}
