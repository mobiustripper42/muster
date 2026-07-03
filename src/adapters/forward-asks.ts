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
import type { ChannelPort } from "../ports/channel.js";
import type { Repository } from "../ports/repository.js";

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
 * Forward fired asks to the channel. Returns how many were accepted by the
 * adapter (≤ asks.length; the shortfall is logged nowhere — see header).
 */
export async function forwardAsks(
  repo: Repository,
  channel: ChannelPort,
  asks: readonly Ask[],
): Promise<number> {
  let forwarded = 0;
  for (const ask of asks) {
    try {
      const [crew, seat] = await Promise.all([
        repo.getCrewMember(ask.crewMemberId),
        repo.getSeat(ask.seatId),
      ]);
      if (!crew || !seat) continue; // dangling ref — nothing to relay
      const shift = await repo.getShift(seat.shiftId);
      if (!shift) continue;
      const [vessel, role] = await Promise.all([
        repo.getVessel(shift.vesselId),
        repo.getRoleType(seat.role),
      ]);

      // The relay text the operator forwards. The magic link is NOT here — the
      // web-link adapter mints + appends it at enqueue (DEC-030); a future
      // Twilio adapter does its own link handling the same way.
      const body = `Muster: ${fmtDate(shift.date)} · ${vessel?.name ?? shift.vesselId} · ${role?.name ?? seat.role} — in or out?`;

      await channel.send({
        to: { crewMemberId: crew.id, phone: crew.phone },
        kind: "ask",
        body,
        seatId: seat.id,
        askId: ask.id,
      });
      forwarded++;
    } catch {
      // Best-effort (see header): the domain action already succeeded.
    }
  }
  return forwarded;
}
