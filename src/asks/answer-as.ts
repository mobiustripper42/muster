/**
 * Identity-guarded ask answer (DEC-030 operator-as-crew clause).
 *
 * The operator is also crew (BrewBoat reality: Spink captains), so some asks in
 * the outbox are addressed to HIM. Those render inline In/Out buttons instead
 * of an `sms:` relay link — but the inline action must not become a back door
 * for answering *anyone's* ask from an admin session: a reliability event
 * recorded against the wrong person corrupts the one log (DEC-008).
 *
 * This is the same ownership gate the crew app's `respondToAsk` action applies
 * inline (`ask.crewMemberId !== subject.id` → ignore), lifted into core so the
 * outbox action and any future inline-answer surface share one tested copy.
 * The answer itself is `recordResponseAndConfirm` — same CAS claim + reliability
 * logging (REQ-CLAIM-1, DEC-007), and a winning "in" auto-confirms (DEC-061).
 */

import type { AskResponse } from "../domain/entities.js";
import type { AskId, CrewMemberId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { recordResponseAndConfirm, type ResponseOutcome } from "./ask-loop.js";

export interface AnswerAsResult {
  /**
   * null = the answer was recorded. `not_yours` = the ask isn't addressed to
   * `asCrewMemberId` (nothing written). `gone` = no such ask (nothing written).
   */
  code: "not_yours" | "gone" | null;
  /** The seat outcome from `recordResponseAndConfirm`, when the answer landed. */
  outcome?: ResponseOutcome;
}

/** Answer `askId` as `asCrewMemberId` — refusing any ask addressed to someone else. */
export async function recordResponseAs(
  repo: Repository,
  askId: AskId,
  asCrewMemberId: CrewMemberId,
  response: AskResponse,
  now: Date,
): Promise<AnswerAsResult> {
  const ask = await repo.getAsk(askId);
  if (!ask) return { code: "gone" };
  if (ask.crewMemberId !== asCrewMemberId) return { code: "not_yours" };
  const outcome = await recordResponseAndConfirm(repo, askId, response, now);
  return { code: null, outcome };
}
