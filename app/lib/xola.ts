import {
  makeXolaFetcher,
  XOLA_API_BASE_DEFAULT,
  XOLA_API_VERSION,
} from "@core/import/xola-client.js";
import type { XolaEnv } from "@core/import/xola-client.js";
import { pullXola } from "@core/import/xola-pull.js";
import type { XolaPullResult } from "@core/import/xola-pull.js";
import type { Repository } from "@core/ports/repository.js";
import { forwardFormNotices } from "./channel";

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
  // cancelledCrew → "you're off"; restoredCrew (#244 resurrection) → "you're on".
  // Shared with the split/merge commands via `forwardFormNotices`. In prod the
  // channel is Twilio (per-send, no dedup); the outbox fallback dedupes by slot.
  try {
    await forwardFormNotices(result.form);
  } catch {
    // best-effort — the pull stands regardless
  }
  return result;
}
