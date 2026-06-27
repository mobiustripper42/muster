"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordResponseAs } from "@core/asks/answer-as.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../../lib/auth";
import { OPERATOR_CREW_MEMBER_ID } from "../../../lib/operator";
import { getRepo } from "../../../lib/repo";

/**
 * Outbox actions (DEC-030) — auth + glue, no client JS (DEC-026 pattern):
 * feedback rides redirect search params as CODES/ids only, never prose (the
 * page maps them to copy). `redirect()` throws by design and stays OUTSIDE the
 * try; only the domain/repo call is guarded (an outage → a mapped notice, not
 * a 500).
 *
 * - recordSent flips `OutboxEntry.status` to sent — channel-side bookkeeping the
 *   domain never reads. Called from the single-click Send island (DEC-030): the
 *   one `'use client'` exception on these surfaces, so a single tap can BOTH open
 *   the Messages composer (native `sms:` anchor) AND record the send. It does NOT
 *   redirect (that would interrupt the composer handoff) — it returns a status
 *   and the island flips optimistically. "Sent" still means "you fired the
 *   composer", not proof of delivery; Resend re-opens it.
 * - answerOwnAsk is the operator-as-crew inline In/Out. GUARDED: it answers
 *   only an ask addressed to `OPERATOR_CREW_MEMBER_ID` (`recordResponseAs`
 *   refuses anything else) — an admin session is not a back door for writing
 *   reliability events against other people's asks (DEC-008).
 */

const BACK = "/admin/outbox";

function finish(param: string): never {
  revalidatePath(BACK);
  redirect(`${BACK}?${param}`);
}

async function gate(formData: FormData, field: string): Promise<string> {
  const subject = await readSubject();
  const id = String(formData.get(field) ?? "");
  if (!subject || subject.kind !== "admin" || !id) redirect(BACK);
  return id;
}

export async function recordSent(entryId: string): Promise<{ ok: boolean }> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin" || !entryId) return { ok: false };
  try {
    const repo = getRepo();
    const entry = await repo.getOutboxEntry(asId<"OutboxEntryId">(entryId));
    if (!entry) return { ok: false };
    await repo.saveOutboxEntry({
      ...entry,
      status: "sent",
      sentAt: new Date().toISOString(),
    });
    // No redirect AND no revalidate: the island already flipped this card
    // optimistically. A revalidate here would refetch the tree mid-click and
    // could stomp that optimistic flip; the server truth shows on the next
    // natural load (the card moves to the Sent section then).
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Mark a doorbell-ring relay sent (#118, DEC-073) — the ring analog of recordSent,
 * over `ring_outbox`. Same single-click-island contract: no redirect/revalidate
 * (the island flipped optimistically), "sent" = composer fired, not delivery.
 */
export async function recordRingSent(entryId: string): Promise<{ ok: boolean }> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin" || !entryId) return { ok: false };
  try {
    const repo = getRepo();
    const entry = await repo.getRingOutboxEntry(asId<"RingOutboxEntryId">(entryId));
    if (!entry) return { ok: false };
    await repo.saveRingOutboxEntry({
      ...entry,
      status: "sent",
      sentAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function answerOwnAsk(formData: FormData): Promise<void> {
  const askId = await gate(formData, "askId");
  const response = String(formData.get("response") ?? "");
  if (response !== "accepted" && response !== "declined") redirect(BACK);

  let param: string;
  try {
    const out = await recordResponseAs(
      getRepo(),
      asId<"AskId">(askId),
      asId<"CrewMemberId">(OPERATOR_CREW_MEMBER_ID),
      response,
      new Date(),
    );
    if (out.code !== null) {
      param = `obx_error=${out.code}`;
    } else if (response === "accepted" && !out.outcome!.claimed) {
      // A real yes, logged — but someone else won the seat first (REQ-CLAIM-1).
      param = "answered=lost";
    } else {
      param = `answered=${response}`;
    }
  } catch {
    param = "obx_error=unavailable";
  }
  finish(param);
}
