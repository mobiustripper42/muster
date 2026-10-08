import { CrewHeader } from "../../../../../components/crew/crew-header";
import { SubmitButton } from "../../../../../components/ui/submit-button";
import { buildThreadView, type ThreadView } from "@core/crewapp/thread-view.js";
import { asId } from "@core/domain/ids.js";
import { ChatBubble } from "../../../../../components/ui/chat-bubble";
import { Notice } from "../../../../../components/ui/notice";
import { Shell } from "../../../../../components/ui/shell";
import { readSubject } from "../../../../lib/auth";
import { getRepo } from "../../../../lib/repo";
import { CREW_UNAVAILABLE, logSwallowed } from "../../../../lib/swallowed";
import { TENANT_ID } from "../../../../lib/tenant";
import { fmtRunWhen } from "../../../../lib/format";
import { postMessage } from "../actions";
import { messagingEnabled } from "../../../../lib/flags";
import { notFound, redirect } from "next/navigation";
import { Textarea } from "../../../../../components/ui/input";

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
  if (!messagingEnabled()) notFound(); // messaging disabled (#389) — route is dark
  const { threadId } = await params;
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") redirect("/crew"); // /crew owns the login UI

  let view: ThreadView | null;
  try {
    view = await buildThreadView(getRepo(), asId<"ThreadId">(threadId), subject, TENANT_ID, new Date());
  } catch (e) {
    logSwallowed("crew/thread", e, "the thread view did not build");
    return (
      <Shell>
        <CrewHeader title="Conversation" back={{ href: "/crew/threads", label: "Messages" }} />
        <Notice>{CREW_UNAVAILABLE}</Notice>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <CrewHeader title="Conversation" back={{ href: "/crew/threads", label: "Messages" }} />
        <Notice>That conversation isn’t on your list.</Notice>
      </Shell>
    );
  }

  return (
    <Shell>
      <CrewHeader title={view.title} back={{ href: "/crew/threads", label: "Messages" }} />

      <section className="flex flex-col gap-2">
        {view.messages.length === 0 ? (
          <Notice>No messages yet. Say something.</Notice>
        ) : (
          view.messages.map((m) => (
            <ChatBubble
              key={m.id}
              mine={m.mine}
              sender={m.mine ? "You" : m.senderLabel}
              priority={m.priority}
              at={fmtRunWhen(m.createdAt)}
            >
              {m.body}
            </ChatBubble>
          ))
        )}
      </section>

      {/* Compose — server action, no client JS. The textarea clears on the
          revalidated re-render (uncontrolled input). */}
      <form action={postMessage} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="threadId" value={view.threadId} />
        <Textarea
          name="body"
          required
          rows={2}
          aria-label="Message"
          placeholder="Message…"
          className="w-full resize-none"
        />
        <SubmitButton className="btn-primary min-h-[44px] w-full">
          Send
        </SubmitButton>
      </form>
    </Shell>
  );
}

