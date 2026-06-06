"use server";

import { revalidatePath } from "next/cache";
import { recordResponse } from "@core/asks/ask-loop.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../lib/auth";
import { getRepo } from "../../lib/repo";

/**
 * Answer an ask — the In/Out tap (SPEC §2.6.1). Driven by a <form action>, so it
 * works with no client JS. Guards two ways: the caller must hold a crew session,
 * AND the ask must actually be addressed to them (no answering someone else's ask
 * by forging the id). The seat-state race itself is handled downstream by
 * recordResponse's CAS (REQ-CLAIM-1).
 */
export async function respondToAsk(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") return;

  const askId = String(formData.get("askId") ?? "");
  const response = String(formData.get("response") ?? "");
  if (!askId || (response !== "accepted" && response !== "declined")) return;

  const repo = getRepo();
  const ask = await repo.getAsk(asId<"AskId">(askId));
  if (!ask || ask.crewMemberId !== subject.id) return; // not yours — ignore

  await recordResponse(repo, asId<"AskId">(askId), response, new Date());
  revalidatePath("/crew");
}
