"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asId } from "@core/domain/ids.js";
import {
  dmThreadId,
  participantId,
  type Message,
} from "@core/messaging/entities.js";
import { myThreads } from "@core/crewapp/thread-list.js";
import { readSubject } from "../../../lib/auth";
import { getRepo, getPresence } from "../../../lib/repo";
import { TENANT_ID } from "../../../lib/tenant";

/**
 * Post a message into a thread (#117, §10). Driven by a <form action> — no client
 * JS. Two guards: a crew session, AND the thread must be one of the poster's own
 * (`myThreads` is the DEC-052 authorization predicate, so a forged thread id can't
 * post into someone else's conversation). The thread row is find-or-created here
 * (`myThreads` hands back the synthesized standing thread), so a never-posted
 * cohort/shift/all-staff thread materializes on its first message. The author's own
 * post marks the thread read (cancel-on-read, §7.2) and records presence (DEC-047).
 */
export async function postMessage(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") return;

  const threadId = String(formData.get("threadId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!threadId || !body) return;

  const repo = getRepo();
  const now = new Date();
  const nowIso = now.toISOString();
  const mine = await myThreads(repo, asId<"CrewMemberId">(subject.id), TENANT_ID, now);
  const match = mine.find((t) => String(t.thread.id) === threadId);
  if (!match) return; // not a member — ignore

  await repo.saveThread(match.thread); // idempotent find-or-create

  const message: Message = {
    id: asId<"MessageId">(`msg-${randomUUID()}`),
    threadId: match.thread.id,
    senderId: subject.id,
    senderKind: "crew",
    body,
    createdAt: nowIso,
    priority: false, // crew never set priority — operator-only (§7.4, 6.8)
  };
  await repo.saveMessage(message);
  // Posting is reading + activity: cancel any pending ring to me, and signal presence.
  await repo.recordRead(match.thread.id, subject, nowIso);
  await getPresence().recordActivity(subject, nowIso);

  revalidatePath(`/crew/threads/${threadId}`);
  revalidatePath("/crew/threads");
  revalidatePath("/crew");
}

/**
 * Start (or reopen) a DM with a crewmate (#117, §6 number-privacy property) — the
 * shift-card "Message" tap. Deterministic ids make it idempotent: re-tapping the
 * same crewmate reuses the one thread + two participant rows, never duplicates.
 * Lands you in the (possibly empty) thread to compose.
 */
export async function startDm(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") return;

  const otherId = String(formData.get("crewMemberId") ?? "");
  if (!otherId || otherId === subject.id) return; // no self-DM

  const repo = getRepo();
  const other = await repo.getCrewMember(asId<"CrewMemberId">(otherId));
  if (!other) return; // unknown crewmate — ignore a forged id

  const me = asId<"CrewMemberId">(subject.id);
  const them = asId<"CrewMemberId">(otherId);
  const threadId = dmThreadId(TENANT_ID, me, them);
  const existing = await repo.getThread(threadId);
  await repo.saveThread(
    existing ?? {
      id: threadId,
      tenantId: TENANT_ID,
      kind: "dm",
      scopeRef: null,
      createdAt: new Date().toISOString(),
    },
  );
  await repo.saveParticipant({ id: participantId(threadId, me), threadId, crewMemberId: me });
  await repo.saveParticipant({ id: participantId(threadId, them), threadId, crewMemberId: them });

  redirect(`/crew/threads/${threadId}`);
}
