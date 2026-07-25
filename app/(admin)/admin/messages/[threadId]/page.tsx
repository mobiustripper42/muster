import { AppLink } from "../../../../../components/ui/app-link";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { buildThreadView, type ThreadView } from "@core/crewapp/thread-view.js";
import { asId } from "@core/domain/ids.js";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { AdminSignedOut } from "../../../../../components/admin/admin-signed-out";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";
import { TENANT_ID } from "../../../../lib/tenant";
import { fmtRunWhen } from "../../../../lib/format";
import { postOperatorMessage } from "../actions";
import { messagingEnabled } from "../../../../lib/flags";
import { notFound } from "next/navigation";

/**
 * Operator thread view (#118, §10) — reuses `buildThreadView` with the admin viewer
 * (DEC-052 cross-visibility, DEC-072): the operator reads ANY thread. Compose posts
 * as the office (`senderKind:"admin"`), with an optional **priority** flag (§7.4 —
 * the operator's alone). Same bubble idiom as the crew view; no read/presence is
 * recorded (the operator isn't a doorbell recipient — DEC-072).
 */

export const dynamic = "force-dynamic";

export default async function AdminThread({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  if (!messagingEnabled()) notFound(); // messaging disabled (#389) — route is dark
  const { threadId } = await params;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") {
    return <AdminSignedOut subject={subject} />;
  }

  let view: ThreadView | null;
  try {
    view = await buildThreadView(getRepo(), asId<"ThreadId">(threadId), subject, TENANT_ID, new Date());
  } catch {
    return (
      <Shell>
        <BackLink />
        <Notice tone="bad">Can’t reach this conversation right now. Try again in a moment.</Notice>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <BackLink />
        <Notice>That thread isn’t available.</Notice>
      </Shell>
    );
  }

  return (
    <Shell>
      <BackLink />
      <h1 className="text-lg font-semibold text-ink">{view.title}</h1>

      <section className="flex flex-col gap-2">
        {view.messages.length === 0 ? (
          <Notice>No messages yet. Post the first one below.</Notice>
        ) : (
          view.messages.map((m) => (
            <div
              key={m.id}
              className={`flex max-w-[85%] flex-col gap-0.5 rounded-card border px-3 py-2 ${
                m.mine
                  ? "self-end border-accent bg-accent text-white"
                  : "self-start border-line bg-card text-ink"
              }`}
            >
              <span
                className={`flex items-center gap-2 text-[11px] ${m.mine ? "text-white/80" : "text-muted"}`}
              >
                <span className="font-semibold">{m.mine ? "You (office)" : m.senderLabel}</span>
                {m.priority && (
                  <span className="font-semibold uppercase tracking-wide">· Priority</span>
                )}
                <span>· {fmtRunWhen(m.createdAt)}</span>
              </span>
              <span className="whitespace-pre-wrap break-words text-sm">{m.body}</span>
            </div>
          ))
        )}
      </section>

      {/* Compose as the office — only the two broadcast doors (all-staff / today's
          cohort, §10). Shift threads + crew DMs are read-only: the operator sees
          them (DEC-052) but never posts in (no injecting into a private DM).
          Priority (§7.4) is the operator's alone; crew can't set it. No client JS. */}
      {view.canPost ? (
        <form action={postOperatorMessage} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="threadId" value={view.threadId} />
          <textarea
            name="body"
            required
            rows={2}
            placeholder="Message…"
            className="w-full resize-none rounded-card border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-faint"
          />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="priority" className="h-4 w-4" />
            Priority — ring now, skip the batch hold
          </label>
          <SubmitButton className="min-h-[44px] w-full rounded-lg bg-accent px-4 font-semibold text-white">
            Send
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-2 text-sm text-muted">
          Read-only — post to <b>All staff</b> or <b>Today’s crew</b> to reach crew.
        </p>
      )}
    </Shell>
  );
}

function BackLink() {
  return (
    <AppLink href="/admin/messages" className="text-sm font-semibold text-accent">
      ‹ Messages
    </AppLink>
  );
}
