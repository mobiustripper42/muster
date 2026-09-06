import { headers } from "next/headers";
import { forwardAsks } from "@core/adapters/forward-asks.js";
import {
  forwardNotices,
  type AssignmentChange,
} from "@core/adapters/forward-notices.js";
import { LogChannel } from "@core/adapters/log-channel.js";
import { isProdDeploy } from "./flags";
import type { Ask } from "@core/domain/entities.js";
import type { FormResult } from "@core/builder/form-shifts.js";
import { formNoticeChanges } from "@core/builder/form-notices.js";
import { getRepo } from "./repo";
import { OPERATOR_CREW_MEMBER_ID } from "./operator";
import { makeTwilioChannel } from "./sms";
import { stripTrailingSlashes } from "@core/config/base-url.js";

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
  if (configured) return stripTrailingSlashes(configured);
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
 * The channel when Twilio is not configured (#934). It logs the message it would have
 * sent, magic link and all, and that is the whole of what replaced the outbox: three
 * queues, three tables and a screen whose only surviving job was letting a human read
 * a message nothing could deliver.
 *
 * Severity is the app's call, not the core's: `console.error` in production so sheepdog
 * ingests it (sheepdog issue 62), a plain log in dev where you are already watching the
 * terminal. Same split as `app/lib/unsent.ts` on the reservations side (#933).
 *
 * Exported because `doorbell.ts` needs the identical construction for its ring relay —
 * one place to change when the severity rule does.
 */
export function logChannel(
  repo: ReturnType<typeof getRepo>,
  linkBase: string,
  now?: () => Date,
): LogChannel {
  return new LogChannel(repo, {
    linkBase,
    ...(now ? { now } : {}),
    sink: isProdDeploy() ? (l) => console.error(l) : (l) => console.log(l),
  });
}

/**
 * Forward fired asks to the pilot outbox — the edge wiring's one line
 * (DEC-030 ruling: the channel is injected at the edge, never threaded through
 * the core ask loop). Best-effort by design: the domain action already
 * committed; a channel hiccup must not turn it into a 500 (`forwardAsks`
 * swallows per-ask failures).
 */
export async function relayAsks(
  asks: readonly Ask[] | undefined,
): Promise<void> {
  if (!asks || asks.length === 0) return;
  const repo = getRepo();
  const base = await linkBase();
  const channel = makeTwilioChannel(repo, base) ?? logChannel(repo, base);
  await forwardAsks(repo, channel, asks);
}

/**
 * Forward assignment-change notices (DEC-084) to the pilot outbox — the notice
 * sibling of `relayAsks`, same edge-injection + best-effort posture. The pilot
 * adapter is `OutboxNoticeChannel` (enqueues a `NoticeOutboxEntry`); the Twilio swap
 * later is a different constructor here, zero domain change (DEC-MSG-1). The caller
 * has already excluded the operator (DEC-072/084).
 */
export async function relayNotices(
  changes: readonly AssignmentChange[] | undefined,
): Promise<void> {
  if (!changes || changes.length === 0) return;
  const repo = getRepo();
  const base = await linkBase();
  const channel = makeTwilioChannel(repo, base) ?? logChannel(repo, base);
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
  await relayNotices(formNoticeChanges(form, OPERATOR_CREW_MEMBER_ID));
  await recordFormChanges(form);
}

/**
 * Persist the trip-change diff so the crew APP can describe it later (#769, DEC-158 Decision 4).
 *
 * **Here rather than at the call sites, for the reason above this function.** `formShifts`
 * CONSUMES the change — the new state is written, so no later run re-sees it — and there are six
 * callers. The relay already carries "miss it and the crew member is never told"; the app banner
 * has exactly the same property, and a seventh caller added next year will remember one call, not
 * two. `forwardFormNotices` is not being made to do an unrelated job: telling the crew what moved
 * through the app is the same job as telling them by SMS, and the SMS is deliberately a strict
 * subset of it.
 *
 * **Not inside `formShifts`.** That loop already writes per iteration with no transaction, which
 * is issue #766 — a mid-loop failure loses a crew notice permanently. `changedCrew` is *returned*,
 * so persisting it out here is one batched insert and makes #766 no worse.
 *
 * Best-effort like its sibling: a failed insert must not take down the SMS relay that just
 * succeeded. The crew member still gets told; they just cannot re-read the detail in the app.
 */
async function recordFormChanges(form: FormResult): Promise<void> {
  if (form.changedCrew.length === 0) return;
  // The relay's own instant rather than the caller's `now`. They differ by however long the
  // notice fan-out took, and nothing compares this against the tick's clock — it is only ever
  // read back against a dismissal the crew member makes later.
  const at = new Date().toISOString();
  try {
    await getRepo().recordShiftChanges(
      form.changedCrew.map((c) => ({
        shiftId: c.shiftId,
        crewMemberId: c.crewMemberId,
        changedAt: at,
        added: c.added.map(String),
        removed: c.removed.map(String),
        startBefore: c.startBefore,
        startAfter: c.startAfter,
      })),
    );
  } catch (e) {
    console.error("[crew] shift-change record failed — the app banner will not show this one", e);
  }
}
