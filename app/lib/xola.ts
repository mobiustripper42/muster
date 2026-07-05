import {
  makeXolaFetcher,
  XOLA_API_BASE_DEFAULT,
  XOLA_API_VERSION,
} from "@core/import/xola-client.js";
import type { XolaEnv } from "@core/import/xola-client.js";
import { pullXola } from "@core/import/xola-pull.js";
import type { XolaPullResult } from "@core/import/xola-pull.js";
import type { Repository } from "@core/ports/repository.js";
import { forwardNoticesToOutbox } from "./channel";
import { OPERATOR_CREW_MEMBER_ID } from "./operator";

/**
 * Edge glue for the Xola pull (DEC-036, DEC-020) — the ONLY place that reads the
 * server-only `XOLA_*` env and binds global `fetch`. All logic lives in
 * `@core/import/xola-pull`, tested with a fake fetcher; this just wires the real
 * network in.
 */

/** Read + validate the server-only Xola config. Throws if the key/seller is unset. */
export function readXolaEnv(): XolaEnv {
  const apiKey = process.env.XOLA_API_KEY;
  const sellerId = process.env.XOLA_SELLER_ID;
  if (!apiKey || !sellerId) {
    throw new Error(
      "Xola import not configured — set XOLA_API_KEY and XOLA_SELLER_ID (server-only).",
    );
  }
  return {
    apiKey,
    sellerId,
    base: process.env.XOLA_API_BASE ?? XOLA_API_BASE_DEFAULT,
    apiVersion: process.env.XOLA_API_VERSION ?? XOLA_API_VERSION,
  };
}

/** Run one live pull against the configured Xola account. */
export async function runXolaPull(
  repo: Repository,
  now: Date,
): Promise<XolaPullResult> {
  const env = readXolaEnv();
  const fetcher = makeXolaFetcher(env);
  const result = await pullXola(repo, fetcher, env.sellerId, now);
  // DEC-084: a pull that CANCELS a shift silently drops its confirmed crew — relay
  // each a "you're off" notice (excluding the operator). Best-effort: the import
  // already committed, so a channel hiccup must not fail the pull. The source is
  // transition-only (form-shifts) + the notice id is deterministic, so a later pull
  // of the same cancelled shift doesn't duplicate.
  try {
    await forwardNoticesToOutbox([
      // DEC-084: a cancelled shift silently drops its confirmed crew → "you're off".
      ...result.form.cancelledCrew
        .filter((c) => String(c.crewMemberId) !== OPERATOR_CREW_MEMBER_ID)
        .map((c) => ({
          crewMemberId: c.crewMemberId,
          action: "removed" as const,
          shiftId: c.shiftId,
        })),
      // #244: a resurrected shift silently re-confirms crew who were told "you're
      // off" → the matching "you're on", closing the mismatch. Best-effort, same as
      // the cancel relay. NB the notice slot is keyed (shift, member, action): the
      // "added" here can't clobber the sibling "removed" from the same cancel/revive
      // pair, but it DOES share a slot with a manual admin "you're on" for the same
      // shift+member — if that fired+sent earlier, this resurrection "on" no-ops
      // (OutboxNoticeChannel is terminal-on-sent). Pre-existing slot-reopen gap,
      // tracked in #259.
      ...result.form.restoredCrew
        .filter((c) => String(c.crewMemberId) !== OPERATOR_CREW_MEMBER_ID)
        .map((c) => ({
          crewMemberId: c.crewMemberId,
          action: "added" as const,
          shiftId: c.shiftId,
        })),
    ]);
  } catch {
    // best-effort — the pull stands regardless
  }
  return result;
}
