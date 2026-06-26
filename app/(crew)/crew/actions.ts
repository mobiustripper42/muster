"use server";

import { redirect } from "next/navigation";
import { recordResponseAndConfirm } from "@core/asks/ask-loop.js";
import { asId } from "@core/domain/ids.js";
import { readSubject } from "../../lib/auth";
import { getRepo } from "../../lib/repo";

/**
 * Answer an ask — the In/Out tap (SPEC §2.6.1). Driven by a <form action>, so it
 * works with no client JS. Guards two ways: the caller must hold a crew session,
 * AND the ask must actually be addressed to them (no answering someone else's ask
 * by forging the id). The seat-state race itself is handled downstream by
 * recordResponse's CAS (REQ-CLAIM-1). A winning "in" auto-confirms — `Claimed →
 * Confirmed` in one step (DEC-061), so "in" means committed, no operator gate.
 *
 * Feedback rides a redirect param (codes only, DEC-026), so the tap never lands
 * in silence (#161): an "in" that LOST the CAS race (someone won the seat first)
 * gets an explicit "already filled" notice instead of the card just vanishing.
 * `redirect()` throws by design and stays OUTSIDE the try.
 */
export async function respondToAsk(formData: FormData): Promise<void> {
  const subject = await readSubject();
  if (!subject || subject.kind !== "crew") return;

  const askId = String(formData.get("askId") ?? "");
  const response = String(formData.get("response") ?? "");
  if (!askId || (response !== "accepted" && response !== "declined")) return;

  let param: string;
  try {
    const repo = getRepo();
    const ask = await repo.getAsk(asId<"AskId">(askId));
    if (!ask || ask.crewMemberId !== subject.id) {
      param = ""; // not yours (or gone) — silent reload, no notice
    } else {
      const out = await recordResponseAndConfirm(
        repo,
        asId<"AskId">(askId),
        response,
        new Date(),
      );
      param =
        response === "declined"
          ? "answered=out"
          : out.claimed
            ? "answered=in"
            : "answered=filled"; // #161: lost the CAS race / already filled
    }
  } catch {
    param = "answered=error";
  }
  redirect(param ? `/crew?${param}` : "/crew");
}
