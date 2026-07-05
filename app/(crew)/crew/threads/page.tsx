import { AppLink } from "../../../../components/ui/app-link";
import { BackLink } from "../../../../components/ui/back-link";
import { buildThreadList, type ThreadListView } from "@core/crewapp/thread-list.js";
import { asId } from "@core/domain/ids.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { TENANT_ID } from "../../../lib/tenant";

/**
 * Crew messaging — the thread list (SPEC §2.6 / artifact §10, #117). Insultingly
 * small: cohort (today), your shift(s), all-staff, your DMs, each with an unread
 * count. Refresh-to-see-new — a server render on navigation, no live socket
 * (DEC-045). The unread pill is a calm accent, never an alarm color (§2.5).
 */
export default async function ThreadsPage() {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") {
    return (
      <Shell>
        <Notice>You’re signed out. Tap the link your operator sent.</Notice>
      </Shell>
    );
  }

  let view: ThreadListView;
  try {
    view = await buildThreadList(getRepo(), asId<"CrewMemberId">(subject.id), TENANT_ID, new Date());
  } catch {
    return (
      <Shell>
        <BackLink href="/crew">Home</BackLink>
        <Notice>Can’t reach messages right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  return (
    <Shell>
      <BackLink href="/crew">Home</BackLink>
      <h1 className="text-lg font-semibold text-ink">Messages</h1>
      <section className="flex flex-col gap-2">
        {view.threads.map((t) => (
          <AppLink
            key={t.threadId}
            href={`/crew/threads/${t.threadId}`}
            prefetch={false}
            spinner="overlay"
            className="relative flex items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-3 shadow-sm"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-semibold text-ink">{t.title}</span>
              <span className="truncate text-sm text-muted">
                {t.preview
                  ? `${t.preview.senderLabel}: ${t.preview.body}`
                  : "No messages yet"}
              </span>
            </span>
            {t.unread > 0 && (
              <span
                className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white"
                aria-label={`${t.unread} unread`}
              >
                {t.unread}
              </span>
            )}
          </AppLink>
        ))}
      </section>
    </Shell>
  );
}

