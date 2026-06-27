"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { asId } from "@core/domain/ids.js";
import { operatorStandingTarget } from "@core/crewapp/thread-list.js";
import type { Message } from "@core/messaging/entities.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { OPERATOR_CREW_MEMBER_ID } from "../../../lib/operator";
import { TENANT_ID } from "../../../lib/tenant";

/**
 * Post a message as the operator (#118, §10). Admin session only. The office posts
 * AS `OPERATOR_CREW_MEMBER_ID` with `senderKind:"admin"` — one voice, not the
 * non-identity handle (DEC-058/030 §7). The operator may post to ANY thread
 * (DEC-052): an existing one (reply), or a synth post-target (all-staff / today's
 * cohort) find-or-created on first post. An optional **priority** flag is the
 * operator's alone (§7.4 / DEC-069 — crew hardcode false); manual checkbox only,
 * type-derivation deferred (DEC-072).
 *
 * Records NO read/presence — deliberate, and the inverse of crew `postMessage`: the
 * operator is excluded from doorbell ring-membership (DEC-072), so a `recordRead`
 * here would write state under a `{kind:"crew",id:operator}` key the doorbell never
 * reads for them. (Don't "fix" this by adding the calls.)
 */
export async function postOperatorMessage(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return;

  const threadId = String(formData.get("threadId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const priority = formData.get("priority") === "on";
  if (!threadId || !body) return;

  const repo = getRepo();
  const now = new Date();
  // The operator posts ONLY to the two broadcast doors — all-staff / today's cohort
  // (§10 / #118 AC). A non-target id (a shift thread, or a crew DM the operator can
  // merely read) is rejected, so the office never injects into a private DM.
  const target = operatorStandingTarget(asId<"ThreadId">(threadId), TENANT_ID, now);
  if (!target) return;
  // Preserve an existing row's createdAt; else find-or-create from the synth target.
  const thread = (await repo.getThread(asId<"ThreadId">(threadId))) ?? target;
  await repo.saveThread(thread); // idempotent

  const message: Message = {
    id: asId<"MessageId">(`msg-${randomUUID()}`),
    threadId: thread.id,
    senderId: OPERATOR_CREW_MEMBER_ID,
    senderKind: "admin",
    body,
    createdAt: now.toISOString(),
    priority,
  };
  await repo.saveMessage(message);

  revalidatePath(`/admin/messages/${threadId}`);
  revalidatePath("/admin/messages");
}
