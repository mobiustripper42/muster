import {
  makeXolaFetcher,
  XOLA_API_BASE_DEFAULT,
  XOLA_API_VERSION,
} from "@core/import/xola-client.js";
import type { XolaEnv } from "@core/import/xola-client.js";
import { pullXola } from "@core/import/xola-pull.js";
import type { XolaPullResult } from "@core/import/xola-pull.js";
import type { Repository } from "@core/ports/repository.js";

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
export function runXolaPull(repo: Repository, now: Date): Promise<XolaPullResult> {
  const env = readXolaEnv();
  const fetcher = makeXolaFetcher(env);
  return pullXola(repo, fetcher, env.sellerId, now);
}
