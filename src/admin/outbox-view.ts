/**
 * Operator outbox view model (DEC-030) — the read side of the web-link relay.
 *
 * The outbox page is the operator's relay worklist: every enqueued ask that
 * still needs them, urgency-first. This module assembles that view from the
 * port; framework-free and data-only like crew-view — formatting (countdown
 * copy, the why-line sentence) is the surface's job.
 *
 * READ-MODEL ONLY (DEC-030 guardrail): outbox state is channel-adapter state.
 * Only the adapter writes it and only this view + the outbox page read it —
 * nothing in `src/asks` / `src/builder` / `src/oracle` may. The "why" facts
 * (which ask round this is, what the previous round did) are derived from the
 * seat's existing asks — no new state.
 *
 * An entry leaves the worklist the moment its ask is settled (answered OR
 * timed out): there is nothing left for the operator to relay. Settled-entry
 * rows are dropped here, not deleted — the outbox is a queue view, not a log.
 */

import type { OutboxEntry, OutboxStatus } from "../domain/entities.js";
import type { Repository } from "../ports/repository.js";
import { earliestScheduledStart, shiftEndFromEvents } from "../builder/derive.js";
import { TENANT_TIMEZONE } from "../config/tenant.js";

/** Why this relay exists — derived from the seat's prior ask rounds. */
export interface OutboxWhy {
  /**
   * Which ask ROUND this is for the seat (1-based). A Tier-1 broadcast fires
   * many asks at one instant — that's one round, so every card of the same
   * broadcast reads "1st ask", and a Tier-2 nudge after it reads "2nd ask".
   */
  ordinal: number;
  /**
   * The most recent prior round's negative outcome, if any — "Quint declined"
   * / "Quint went silent". Null when this is the first round (or the only
   * settled prior is an accept — we don't guess at why an acceptor left).
   */
  prior: { crewName: string; outcome: "declined" | "silent" } | null;
}

export interface OutboxCardView {
  entryId: string;
  askId: string;
  crewMemberId: string;
  crewName: string;
  /** The `sms:` target. Operator-entered (DEC-010); may be empty for a stub row. */
  crewPhone: string;
  vesselName: string;
  roleName: string;
  /** ISO-8601 shift date (vessel-local day). */
  date: string;
  /** Earliest scheduled departure, ISO-8601 UTC — null if the shift lost its events. */
  tripStart: string | null;
  /**
   * Shift end, ISO-8601 UTC (DEC-041) — latest departure + trip length +
   * teardown (#275). The close of the start–end window the card shows; null when
   * no scheduled event anchors the shift (same as `tripStart`).
   */
  tripEnd: string | null;
  /** Hours from `now` to `tripStart` (negative = departed) — the urgency key. */
  hoursToTrip: number | null;
  status: OutboxStatus;
  /** ISO-8601 UTC — when the operator marked it sent (sent cards only). */
  sentAt: string | null;
  /** Relay text + magic link, VERBATIM from enqueue (DEC-030) — never re-derived. */
  body: string;
  link: string;
  why: OutboxWhy;
}

export interface OutboxView {
  /** Needs the operator: untexted relays, tightest trip first. */
  pending: OutboxCardView[];
  /** Texted, awaiting the crew member's answer — display muted, same order. */
  sent: OutboxCardView[];
}

/** Tightest trip first; undated shifts sink to the bottom (nothing to race). */
function byTightness(a: OutboxCardView, b: OutboxCardView): number {
  if (a.hoursToTrip === null) return b.hoursToTrip === null ? 0 : 1;
  if (b.hoursToTrip === null) return -1;
  return a.hoursToTrip - b.hoursToTrip;
}

/** Assemble the outbox view as of `now`. */
export async function buildOutboxView(
  repo: Repository,
  now: Date,
  opts?: { tz?: string },
): Promise<OutboxView> {
  const tz = opts?.tz ?? TENANT_TIMEZONE;
  const entries = await repo.listOutboxEntries();
  const [crew, vessels, roles] = await Promise.all([
    repo.listCrewMembers(),
    repo.listVessels(),
    repo.listAllRoleTypes(),
  ]);
  const crewById = new Map(crew.map((c) => [c.id as string, c]));
  const vesselName = new Map(vessels.map((v) => [v.id as string, v.name]));
  const roleName = new Map(roles.map((r) => [r.id as string, r.name]));
  const nameOf = (id: string) => crewById.get(id)?.name ?? id;

  const cards: OutboxCardView[] = [];
  for (const entry of entries) {
    const ask = await repo.getAsk(entry.askId);
    // Settled (answered or timed out) or vanished → nothing left to relay.
    if (!ask || ask.respondedAt !== undefined) continue;

    const seat = await repo.getSeat(entry.seatId);
    const shift = seat ? await repo.getShift(seat.shiftId) : null;
    if (!seat || !shift) continue; // dangling spine — integrity's job, not the page's

    const events = [];
    for (const eventId of shift.eventIds) {
      const event = await repo.getEvent(eventId);
      if (event) events.push(event);
    }
    const tripStart = earliestScheduledStart(events, tz);
    const tripEnd = shiftEndFromEvents(events, tz);

    cards.push({
      entryId: entry.id,
      askId: entry.askId,
      crewMemberId: entry.crewMemberId,
      crewName: nameOf(entry.crewMemberId),
      crewPhone: crewById.get(entry.crewMemberId)?.phone ?? "",
      vesselName: vesselName.get(shift.vesselId) ?? String(shift.vesselId),
      roleName: roleName.get(seat.role) ?? String(seat.role),
      date: shift.date,
      tripStart: tripStart ? tripStart.toISOString() : null,
      tripEnd: tripEnd ? tripEnd.toISOString() : null,
      hoursToTrip: tripStart
        ? (tripStart.getTime() - now.getTime()) / 3_600_000
        : null,
      status: entry.status,
      sentAt: entry.sentAt ?? null,
      body: entry.body,
      link: entry.link,
      why: await deriveWhy(repo, entry, ask.sentAt, nameOf),
    });
  }

  return {
    pending: cards.filter((c) => c.status === "pending").sort(byTightness),
    sent: cards.filter((c) => c.status === "sent").sort(byTightness),
  };
}

/**
 * Derive the why facts from the seat's asks (read-model, no new state):
 * rounds = distinct `sentAt` instants (a broadcast is one round), ordinal =
 * this ask's round position, prior = the latest earlier round's negative
 * outcome by the person it went to.
 */
async function deriveWhy(
  repo: Repository,
  entry: OutboxEntry,
  sentAt: string,
  nameOf: (id: string) => string,
): Promise<OutboxWhy> {
  const seatAsks = await repo.listAsksForSeat(entry.seatId);
  const rounds = [...new Set(seatAsks.map((a) => a.sentAt))].sort();
  const ordinal = rounds.filter((r) => r <= sentAt).length || 1;

  // Most recent settled negative among earlier asks. Deterministic across
  // adapters (list order is unspecified): later round wins; on a same-instant
  // tie a named decline beats a silence (the more informative why-line).
  let best: (typeof seatAsks)[number] | undefined;
  for (const a of seatAsks) {
    if (a.sentAt >= sentAt || a.respondedAt === undefined) continue;
    if (a.response === "accepted") continue; // an acceptor left; don't guess why
    if (
      !best ||
      a.sentAt > best.sentAt ||
      (a.sentAt === best.sentAt &&
        a.response === "declined" &&
        best.response !== "declined")
    ) {
      best = a;
    }
  }
  const prior: OutboxWhy["prior"] = best
    ? {
        crewName: nameOf(best.crewMemberId),
        outcome: best.response === "declined" ? "declined" : "silent",
      }
    : null;
  return { ordinal, prior };
}
