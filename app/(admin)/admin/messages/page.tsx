import { AppLink } from "../../../../components/ui/app-link";
import { buildOperatorThreads, type OperatorThreadsView } from "@core/admin/operator-threads.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { TENANT_ID } from "../../../lib/tenant";

/**
 * Operator messaging (#118, artifact §10) — every thread the operator can read or
 * post to. All-staff + today's cohort lead (the broadcast doors); the rest, by
 * recency, is the cross-visibility worklist (shift threads + crew DMs, DEC-052). A
 * deliberate PULL surface (DEC-042): no unread badge — the operator watches, they
 * aren't rung (DEC-072). Force-dynamic; live on every load.
 */

export const dynamic = "force-dynamic";

export default async function AdminMessages() {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin")
    return <AdminSignedOut subject={subject} />;

  let view: OperatorThreadsView;
  try {
    view = await buildOperatorThreads(getRepo(), TENANT_ID, new Date());
  } catch {
    return (
      <Shell>
        <BackLink />
        <Notice tone="bad">Can’t reach messages right now. Try again in a moment.</Notice>
      </Shell>
    );
  }

  return (
    <Shell>
      <BackLink />
      <h1 className="text-lg font-semibold text-ink">Messages</h1>
      <section className="flex flex-col gap-2">
        {view.threads.map((t) => (
          <AppLink
            key={t.threadId}
            href={`/admin/messages/${t.threadId}`}
            spinner="overlay"
            className="relative flex min-w-0 flex-col rounded-card border border-line bg-card px-4 py-3 shadow-sm"
          >
            <span className="truncate font-semibold text-ink">{t.title}</span>
            <span className="truncate text-sm text-muted">
              {t.preview ? `${t.preview.senderLabel}: ${t.preview.body}` : "No messages yet"}
            </span>
          </AppLink>
        ))}
      </section>
    </Shell>
  );
}

function BackLink() {
  return (
    <AppLink href="/admin" className="text-sm font-semibold text-accent">
      ‹ Admin
    </AppLink>
  );
}
