/**
 * The one definition of an outbound message's opener (#599).
 *
 * **Why this exists.** Every admin is also crew (DEC-092), so an operator is the only
 * human receiving both classes of message — on one phone, from one sender — and has to
 * decide which hat applies before acting. A crew ask is a personal commitment ("will
 * you work this?"); a board alert is an operational escalation ("nobody will work this
 * — go do something"). Reading one as the other means either a shift you thought you'd
 * taken, or a shift you thought someone else was handling. It happened: on 2026-07-29 a
 * captain bailed on `Brew 4`, and the operator read the board alert as an ask.
 *
 * **Why a shared module rather than a fix at one call site.** The distinguishing words
 * used to sit at the END of the first line, behind a date and a vessel name, and the
 * two openers differed by a single leading character (`⚠ Muster:` vs `Muster:`). A
 * lock-screen preview truncates from the RIGHT, so anything but a front-loaded marker
 * is invisible exactly when enough messages are stacked up to need it. Four senders
 * each composed their own opener, which is the shape that drifts — the same shape as
 * the `/admin` hub's two hand-edited menus. One map, four consumers.
 *
 * **What it deliberately does not do:** decide the rest of the message. Body copy stays
 * with each sender; this owns only the first few characters, which is the part that has
 * to be consistent to be useful.
 */

/** Which hat the recipient is wearing when this arrives. */
export type Audience =
  /** The crew member personally — asks, assignment notices, message rings. */
  | "crew"
  /** The operator acting as operator — At-Risk board alerts (DEC-095). */
  | "admin";

/**
 * Audience → opener. Front-loaded and differing by a WORD, not by punctuation or a
 * leading glyph, because the reader is scanning a truncated preview.
 *
 * The wording is the operator's call and changing it is a one-line edit here; the
 * *shape* — marker first, distinct word — is the part that must hold.
 *
 * **The At-Risk alert's leading `⚠` was dropped when this landed** (#599). It was
 * carrying the entire crew-vs-admin distinction and failing at it, and a non-GSM-7
 * character forces the whole SMS to UCS-2 — halving the per-segment budget for the
 * same reason `forward-notices` avoids `·`. The word ADMIN does the job for free.
 *
 * No DEC: SPEC never specified any of these bodies, and #387's sibling rule (a
 * doorbell ring carries no count and no note content) is likewise a code-level fact.
 * The convention is enforced by this signature — you cannot compose an outbound body
 * without naming an audience — which holds better than a document would.
 */
export const OPENER: Record<Audience, string> = {
  crew: "Muster:",
  admin: "Muster ADMIN:",
};

/**
 * Compose an outbound body with its audience marker in front.
 *
 * Idempotent: a body that already starts with its opener is returned unchanged, so a
 * sender part-way through adopting this can't ship `Muster: Muster: …`. That mattered
 * during the migration and is cheap to keep.
 */
export function outbound(audience: Audience, body: string): string {
  const opener = OPENER[audience];
  const trimmed = body.trim();
  if (trimmed.startsWith(opener)) return trimmed;
  return `${opener} ${trimmed}`;
}
