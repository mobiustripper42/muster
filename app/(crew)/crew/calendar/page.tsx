import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import { CrewHeader } from "../../../../components/crew/crew-header";
import { CopyButton } from "../../../../components/ui/copy-button";
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
      <CrewHeader title="Calendar sync" back={{ href: "/crew", label: "My shifts" }} />
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
            <span className="flex items-stretch gap-2">
              <input
                readOnly
                value={feedUrl}
                aria-label="Your calendar feed link"
                className="w-full min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-ink"
              />
              {/* Client-JS island (DEC-098, mirrors DEC-097's progressive-enhancement
                  posture): copying a long URL by hand on a phone is fiddly. No-JS
                  still works — the input is selectable. Handles the insecure
                  http://mill-dev context where navigator.clipboard is undefined. */}
              <CopyButton value={feedUrl} />
            </span>
          </label>
          <AddInstructions />
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
          <AddInstructions />
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

/** How to subscribe the copied link in Google / Apple Calendar (#355). Crew are
 *  mobile-primary, so Apple gets the iPhone flow; Google's "From URL" is web-only. */
function AddInstructions() {
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2 text-xs text-muted">
      <p className="font-semibold text-ink">Add it to your calendar</p>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
        <li>
          <b>Google Calendar</b> (on a computer): Other calendars <b>+</b> → From
          URL → paste the link → Add calendar.
        </li>
        <li>
          <b>Apple Calendar</b> (iPhone): Settings → Calendar → Accounts → Add
          Account → Other → Add Subscribed Calendar → paste the link.
        </li>
      </ul>
      <p className="mt-2 text-[11px] text-faint">
        Your shifts show up right away when you first add the link. After that, a
        new or changed shift appears the next time your calendar app checks in —
        Apple refreshes as often as you set it; Google can take a few hours.
      </p>
    </div>
  );
}
