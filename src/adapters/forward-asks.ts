/**
 * Ask → channel forwarding glue (DEC-030, DEC-MSG-3).
 *
 * The domain ask loop never talks to a transport (ruling: the channel is wired
 * at the EDGE, not threaded through the core). Every fire path — tick's
 * Pending→Filling broadcast, escalate's Tier-2 nudge, the cockpit/board
 * assign + nudge actions, bail's re-asks — already *surfaces* the asks it
 * fired; the edge caller hands them here, one line each. This module turns a
 * fired `Ask` into an `OutboundMessage` (recipient + human body + correlation
 * ids) and pushes it through whatever `ChannelPort` is injected — today the
 * web-link outbox, later Twilio, with this exact glue reused verbatim.
 *
 * BEST-EFFORT by design: a channel hiccup must not turn an already-committed
 * domain action into a 500 — the ask exists either way (the seat machine is
 * the source of truth; delivery is the swappable part). Failures are swallowed
 * per ask and the return value says how many actually forwarded, so a caller
 * that wants to surface "some relays didn't queue" can.
 *
 * NO IDEMPOTENCY NET (9.4): the outbox adapter deduped re-forwards via its
 * deterministic entry id; the Twilio adapter just sends. Every call site today
 * fires once per committed domain event — a new retry-prone caller must bring
 * its own guard or crew get duplicate texts.
 */

import type { Ask } from "../domain/entities.js";
import type { CrewMemberId } from "../domain/ids.js";
import type { ChannelPort } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";
import { outbound } from "./message-opener.js";

/** "Sat, Jul 4" from an ISO date — UTC-pinned so the text is TZ-deterministic. */
function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The per-seat relay text (GSM-7 only — no · or — — so the SMS stays a 1-segment
 * 160-char message, not a 2-segment UCS-2 one). `null` if the seat/shift vanished
 * between firing and forwarding (dangling ref — nothing to relay).
 */
async function singleAskBody(repo: Repository, ask: Ask): Promise<string | null> {
  const seat = await repo.getSeat(ask.seatId);
  if (!seat) return null;
  const shift = await repo.getShift(seat.shiftId);
  if (!shift) return null;
  const [vessel, role] = await Promise.all([
    repo.getVessel(shift.vesselId),
    repo.getRoleType(seat.role),
  ]);
  return outbound(
    "crew",
    `${fmtDate(shift.date)} - ${vessel?.name ?? shift.vesselId} - ${role?.name ?? seat.role}. In or out?`,
  );
}

/**
 * Forward fired asks to the channel, **batched per recipient** (#393). A crew
 * member who drew several asks in one tick gets ONE message — its magic link
 * lands on `/crew`, which already renders all their live asks as In/Out — instead
 * of one SMS per ask (the top candidate for a whole weekend batch would otherwise
 * get a pile of simultaneous texts). Only *delivery* is coalesced: the per-ask
 * domain records are untouched and all show on `/crew`; a batch is sent once,
 * upstream of the channel's per-send cost (one SMS on Twilio; one outbox card on
 * web-link). This is also the module header's missing idempotency net — one send
 * per (recipient, tick), and the tick fires each ask once.
 *
 * Returns how many asks were covered by an accepted send (≤ `asks.length`).
 */
export async function forwardAsks(
  repo: Repository,
  channel: ChannelPort,
  asks: readonly Ask[],
): Promise<number> {
  const byCrew = new Map<CrewMemberId, Ask[]>();
  for (const ask of asks) {
    const group = byCrew.get(ask.crewMemberId);
    if (group) group.push(ask);
    else byCrew.set(ask.crewMemberId, [ask]);
  }

  let forwarded = 0;
  for (const group of byCrew.values()) {
    try {
      const crew = await repo.getCrewMember(group[0]!.crewMemberId);
      if (!crew) continue; // dangling ref — nothing to relay

      // The ask that anchors the outbox entry / reply correlation must have a seat
      // that still resolves — a seat can vanish between firing and forwarding
      // (manning/merge/form-shifts), and a stale `seatId` writes an orphan entry.
      // Lone ask: resolving IS composing its body. Batch: the body is a count, so
      // just walk to the first surviving ask. Skip the group if none survive.
      let rep: Ask | null = null;
      let body: string | null = null;
      if (group.length === 1) {
        body = await singleAskBody(repo, group[0]!);
        if (body !== null) rep = group[0]!;
      } else {
        for (const ask of group) {
          if (await repo.getSeat(ask.seatId)) {
            rep = ask;
            break;
          }
        }
        // Link is crew-scoped → `/crew`, so every live ask in the group is
        // answerable there regardless of which one anchors the entry.
        if (rep !== null) body = outbound("crew", `${group.length} shifts need you. Tap to answer.`);
      }
      if (rep === null || body === null) continue;

      await channel.send({
        to: { crewMemberId: crew.id, phone: crew.phone },
        kind: "ask",
        body,
        seatId: rep.seatId,
        askId: rep.id,
      });
      forwarded += group.length;
    } catch {
      // Best-effort (see header): the domain action already succeeded.
    }
  }
  return forwarded;
}
