"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { asId } from "@core/domain/ids.js";
import { operatorStandingTarget } from "@core/crewapp/thread-list.js";
import type { Message } from "@core/messaging/entities.js";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { TENANT_ID } from "../../../lib/tenant";
import { messagingEnabled } from "../../../lib/flags";

/**
 * Post a message as the office (#118, §10). Admin session only. `senderKind:"admin"` is the
 * one voice crew see ("Operator"); `senderId` is the signed-in admin's own crew id (every
 * admin is crew, DEC-092), so the row records which admin wrote it (issue #293 — it used to
 * be one configured id for every admin). The operator may post to ANY thread
 * (DEC-052): an existing one (reply), or a synth post-target (all-staff / any
 * today-or-future cohort — #317, amending DEC-072) find-or-created on first post. A
 * cohort post auto-leads with "Cohort" (#317). An optional **priority** flag is the
 * operator's alone (§7.4 / DEC-069 — crew hardcode false); manual checkbox only,
 * type-derivation deferred (DEC-072).
 *
 * Records NO read/presence — deliberate, and the inverse of crew `postMessage`: active
 * admins are excluded from doorbell ring-membership (DEC-072), so a `recordRead` here
 * would write state under a `{kind:"crew",id:<admin>}` key the doorbell never reads for
 * them. (Don't "fix" this by adding the calls.)
 */
export async function postOperatorMessage(formData: FormData): Promise<void> {
  if (!messagingEnabled()) return; // messaging disabled (#389) — inert
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

  // A day-of cohort message leads with "Cohort" (#317) so recipients — and the
  // operator scanning /admin/messages — tell it apart from an all-staff broadcast at a
  // glance. Prepend on the cohort thread only, idempotently (never double-prefix).
  const finalBody =
    thread.kind === "cohort" && !/^cohort\b/i.test(body) ? `Cohort — ${body}` : body;

  const message: Message = {
    id: asId<"MessageId">(`msg-${randomUUID()}`),
    threadId: thread.id,
    senderId: subject.id,
    senderKind: "admin",
    body: finalBody,
    createdAt: now.toISOString(),
    priority,
  };
  await repo.saveMessage(message);

  revalidatePath(`/admin/messages/${threadId}`);
  revalidatePath("/admin/messages");
}
