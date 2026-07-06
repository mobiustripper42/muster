import { headers } from "next/headers";
import { forwardAsks } from "@core/adapters/forward-asks.js";
import {
  forwardNotices,
  type AssignmentChange,
} from "@core/adapters/forward-notices.js";
import { WebLinkChannel } from "@core/adapters/web-link-channel.js";
import { OutboxNoticeChannel } from "@core/adapters/outbox-notice-channel.js";
import type { Ask } from "@core/domain/entities.js";
import type { FormResult } from "@core/builder/form-shifts.js";
import { formNoticeChanges } from "@core/builder/form-notices.js";
import { getRepo } from "./repo";
import { OPERATOR_CREW_MEMBER_ID } from "./operator";
import { makeTwilioChannel } from "./sms";

/**
 * App-side channel wiring (DEC-030, DEC-MSG-3). This module is the ONE place
 * the app picks the ask/notice adapters. **With Twilio configured (9.4,
 * DEC-MSG-1) crew relays go out as real SMS**; unset, the pilot web-link relay
 * stays: `send` enqueues an OutboxEntry the operator works from /admin/outbox —
 * dark until the env is set (#70). The swap is exactly the constructors below,
 * zero domain change.
 *
 * Link base: delivered links must come from `APP_BASE_URL` in production (the
 * Host header is client-controlled — see app/lib/base-url.ts on host-header
 * poisoning / token theft). The headers() fallback is dev-only convenience,
 * same posture as the dev-link issuer.
 */
async function linkBase(): Promise<string> {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  // Fail LOUD in prod (the doorbell.ts posture): pre-9.4 a poisoned-Host link
  // at least passed through the operator's outbox; with Twilio live it would be
  // auto-texted straight to a crew phone with an embedded auth token.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "APP_BASE_URL must be set in production — delivered links would ride the client-controlled Host header",
    );
  }
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
  const base = await linkBase();
  const channel =
    makeTwilioChannel(repo, base) ?? new WebLinkChannel(repo, { linkBase: base });
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
  const base = await linkBase();
  const channel =
    makeTwilioChannel(repo, base) ??
    new OutboxNoticeChannel(repo, { linkBase: base });
  await forwardNotices(repo, channel, changes);
}

/**
 * Forward the crew transitions a {@link FormResult} observed (DEC-084) — the
 * `cancelledCrew`→"you're off" / `restoredCrew`→"you're on" mapping. Shared by
 * the Xola pull AND the manual split/merge commands: each runs `formShifts` once
 * and CONSUMES any transition it observes (the new state is written, so no later
 * pull re-sees it), so this single call is the only relay chance. Miss it and a
 * crew member added/removed by that reshape never gets the SMS (#259 finding-3).
 * Operator excluded (DEC-072/084). Best-effort is the caller's (wrap in try/catch).
 */
export async function forwardFormNotices(form: FormResult): Promise<void> {
  await forwardNoticesToOutbox(formNoticeChanges(form, OPERATOR_CREW_MEMBER_ID));
}
