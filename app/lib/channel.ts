import { headers } from "next/headers";
import { forwardAsks } from "@core/adapters/forward-asks.js";
import {
  forwardNotices,
  type AssignmentChange,
} from "@core/adapters/forward-notices.js";
import { WebLinkChannel } from "@core/adapters/web-link-channel.js";
import { OutboxNoticeChannel } from "@core/adapters/outbox-notice-channel.js";
import type { Ask } from "@core/domain/entities.js";
import { getRepo } from "./repo";

/**
 * App-side channel wiring (DEC-030, DEC-MSG-3). The pilot channel is the
 * web-link relay: `send` enqueues an OutboxEntry the operator works from
 * /admin/outbox. This module is the ONE place the app picks an adapter — the
 * Twilio swap later is a different constructor here, zero domain change
 * (DEC-MSG-1).
 *
 * Link base: delivered links must come from `APP_BASE_URL` in production (the
 * Host header is client-controlled — see app/lib/base-url.ts on host-header
 * poisoning / token theft). The headers() fallback is dev-only convenience,
 * same posture as the dev-link issuer.
 */
async function linkBase(): Promise<string> {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * Forward fired asks to the pilot outbox — the edge wiring's one line
 * (DEC-030 ruling: the channel is injected at the edge, never threaded through
 * the core ask loop). Best-effort by design: the domain action already
 * committed; a channel hiccup must not turn it into a 500 (`forwardAsks`
 * swallows per-ask failures).
 */
export async function forwardToOutbox(
  asks: readonly Ask[] | undefined,
): Promise<void> {
  if (!asks || asks.length === 0) return;
  const repo = getRepo();
  const channel = new WebLinkChannel(repo, { linkBase: await linkBase() });
  await forwardAsks(repo, channel, asks);
}

/**
 * Forward assignment-change notices (DEC-084) to the pilot outbox — the notice
 * sibling of `forwardToOutbox`, same edge-injection + best-effort posture. The pilot
 * adapter is `OutboxNoticeChannel` (enqueues a `NoticeOutboxEntry`); the Twilio swap
 * later is a different constructor here, zero domain change (DEC-MSG-1). The caller
 * has already excluded the operator (DEC-072/084).
 */
export async function forwardNoticesToOutbox(
  changes: readonly AssignmentChange[] | undefined,
): Promise<void> {
  if (!changes || changes.length === 0) return;
  const repo = getRepo();
  const channel = new OutboxNoticeChannel(repo, { linkBase: await linkBase() });
  await forwardNotices(repo, channel, changes);
}
