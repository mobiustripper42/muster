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
 * - markSent / markUnsent flip `OutboxEntry.status` — channel-side bookkeeping
 *   the domain never reads. Two taps (open composer, mark sent) is intended:
 *   opening the Messages composer isn't proof the text went out.
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

export async function markSent(formData: FormData): Promise<void> {
  const entryId = await gate(formData, "entryId");
  let param: string;
  try {
    const repo = getRepo();
    const entry = await repo.getOutboxEntry(asId<"OutboxEntryId">(entryId));
    if (!entry) {
      param = "obx_error=gone";
    } else {
      await repo.saveOutboxEntry({
        ...entry,
        status: "sent",
        sentAt: new Date().toISOString(),
      });
      param = `sent=${encodeURIComponent(entryId)}`;
    }
  } catch {
    param = "obx_error=unavailable";
  }
  finish(param);
}

export async function markUnsent(formData: FormData): Promise<void> {
  const entryId = await gate(formData, "entryId");
  let param: string;
  try {
    const repo = getRepo();
    const entry = await repo.getOutboxEntry(asId<"OutboxEntryId">(entryId));
    if (!entry) {
      param = "obx_error=gone";
    } else {
      // Back to to-send: drop the sent stamp entirely (not undefined — the
      // optional field is simply absent again).
      const { sentAt: _sent, ...rest } = entry;
      await repo.saveOutboxEntry({ ...rest, status: "pending" });
      param = `unsent=${encodeURIComponent(entryId)}`;
    }
  } catch {
    param = "obx_error=unavailable";
  }
  finish(param);
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
