import { AppLink } from "../../../../../components/ui/app-link";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { buildThreadView, type ThreadView } from "@core/crewapp/thread-view.js";
import { asId } from "@core/domain/ids.js";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";
import { TENANT_ID } from "../../../../lib/tenant";
import { fmtRunWhen } from "../../../../lib/format";
import { postMessage } from "../actions";

/**
 * Crew messaging — one thread: messages + a compose box, nothing else (artifact
 * §10, #117). Server component, membership-gated (`buildThreadView` returns null
 * unless the viewer is a member — DEC-052). Compose posts to a server action (no
 * client JS); the read mark + presence are recorded by the layout's ActivityBeacon
 * on view (DEC-071). Refresh-to-see-new (DEC-045).
 */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") {
    return (
      <Shell>
        <Notice>You’re signed out. Tap the link your operator sent.</Notice>
      </Shell>
    );
  }

  let view: ThreadView | null;
  try {
    view = await buildThreadView(getRepo(), asId<"ThreadId">(threadId), subject, TENANT_ID, new Date());
  } catch {
    return (
      <Shell>
        <BackLink />
        <Notice>Can’t reach this conversation right now. Try again in a moment.</Notice>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <BackLink />
        <Notice>That conversation isn’t on your list.</Notice>
      </Shell>
    );
  }

  return (
    <Shell>
      <BackLink />
      <h1 className="text-lg font-semibold text-ink">{view.title}</h1>

      <section className="flex flex-col gap-2">
        {view.messages.length === 0 ? (
          <Notice>No messages yet. Say something.</Notice>
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
                <span className="font-semibold">{m.mine ? "You" : m.senderLabel}</span>
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

      {/* Compose — server action, no client JS. The textarea clears on the
          revalidated re-render (uncontrolled input). */}
      <form action={postMessage} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="threadId" value={view.threadId} />
        <textarea
          name="body"
          required
          rows={2}
          placeholder="Message…"
          className="w-full resize-none rounded-card border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-faint"
        />
        <SubmitButton className="min-h-[44px] w-full rounded-lg bg-accent px-4 font-semibold text-white">
          Send
        </SubmitButton>
      </form>
    </Shell>
  );
}

function BackLink() {
  return (
    <AppLink href="/crew/threads" prefetch={false} className="text-sm font-semibold text-accent">
      ‹ Messages
    </AppLink>
  );
}
