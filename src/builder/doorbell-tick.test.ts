/**
 * The doorbell loop end-to-end (#167, 6.6b AC3): a posted message → the tick runs
 * the decider over live store + presence state → rings recorded → relayed through
 * the fake channel. Drives the real `doorbellTick` + `forwardNotifications` over
 * the in-memory repo/presence + `FakeNotificationChannel` — the same wiring the
 * cron route binds to Postgres. Uses an `all_staff` thread so membership is the
 * roster (no shift/seat seeding); `deriveMembers` has its own kind coverage.
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { CrewMember } from "../domain/entities.js";
import type { Message, Thread } from "../messaging/entities.js";
import { FakeNotificationChannel } from "../adapters/fake-notification-channel.js";
import { forwardNotifications } from "../adapters/forward-notifications.js";
import { InMemoryPresence } from "../adapters/in-memory-presence.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { makeDoorbellRules } from "../messaging/doorbell-decider.js";
import { doorbellTick } from "./doorbell-tick.js";
import { RING_NOTIFICATION_BODY } from "../adapters/forward-notifications.js";

const RULES = makeDoorbellRules({
  batchWindowMs: 90_000,
  presenceWindowMs: 300_000,
  shortNoticeMaxChars: 160,
});
const THREAD = asId<"ThreadId">("thread-all_staff-t1-all");
const T0 = "2026-07-04T09:00:00.000Z";
const NOW = new Date("2026-07-04T09:02:00.000Z"); // 2 min after T0 — past the 90s window

const crew = (id: string, name: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name,
  phone: `555-${id}`,
  ratings: [],
  status: "active",
  reliabilityScore: null,
});

const allStaff = (over: Partial<Thread> = {}): Thread => ({
  id: THREAD,
  tenantId: asId<"TenantId">("t1"),
  kind: "all_staff",
  scopeRef: null,
  createdAt: T0,
  ...over,
});

const post = (
  repo: InMemoryRepository,
  id: string,
  body: string,
  createdAt = T0,
  priority = false,
): Promise<void> => {
  const m: Message = {
    id: asId<"MessageId">(id),
    threadId: THREAD,
    senderId: "operator",
    senderKind: "admin",
    body,
    createdAt,
    priority,
  };
  return repo.saveMessage(m);
};

async function seed(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveCrewMember(crew("crew-alice", "Alice"));
  await repo.saveCrewMember(crew("crew-bob", "Bob"));
  await repo.saveThread(allStaff());
  return repo;
}

describe("doorbellTick + forwardNotifications (the loop, #167)", () => {
  it("rings the absent members, records notify-state, relays via the fake channel", async () => {
    const repo = await seed();
    await post(repo, "m1", "dock at slip B"); // short → content
    const r = await doorbellTick(repo, new InMemoryPresence(), NOW, RULES);

    expect(r.threadsSwept).toBe(1);
    expect(r.rings).toHaveLength(2); // alice + bob, both absent
    expect(r.rings.every((d) => d.reason === "batched" && d.mode === "content")).toBe(true);
    expect((await repo.notifyStateForThread(THREAD)).size).toBe(2); // both recorded

    const channel = new FakeNotificationChannel(() => NOW);
    const relayed = await forwardNotifications(repo, channel, r.rings);
    expect(relayed).toBe(2);
    // Bare notification (#387) — the note's text never rides the SMS, even in
    // content mode; both absent members get the same pointer line.
    expect(channel.sent.map((s) => s.body)).toEqual([
      RING_NOTIFICATION_BODY,
      RING_NOTIFICATION_BODY,
    ]);
  });

  it("a second sweep is quiet — first-only-until-read holds on recorded notify-state", async () => {
    const repo = await seed();
    await post(repo, "m1", "hi");
    const presence = new InMemoryPresence();
    await doorbellTick(repo, presence, NOW, RULES); // records notify-state
    const r2 = await doorbellTick(repo, presence, new Date("2026-07-04T09:04:00.000Z"), RULES);
    expect(r2.rings).toHaveLength(0);
    expect(r2.decisions.every((d) => d.reason === "already_notified")).toBe(true);
  });

  it("presence suppresses a member's ring (toast, and records no ring)", async () => {
    const repo = await seed();
    await post(repo, "m1", "hi");
    const presence = new InMemoryPresence();
    await presence.recordActivity({ kind: "crew", id: "crew-alice" }, "2026-07-04T09:01:30.000Z"); // 30s ago
    const r = await doorbellTick(repo, presence, NOW, RULES);

    const alice = r.decisions.find((d) => d.subject.id === "crew-alice");
    const bob = r.decisions.find((d) => d.subject.id === "crew-bob");
    expect(alice).toMatchObject({ channel: "in_app_toast", ring: false });
    expect(bob?.ring).toBe(true);
    expect(r.rings).toHaveLength(1);
    const notify = await repo.notifyStateForThread(THREAD);
    expect(notify.has("crew:crew-alice")).toBe(false); // a toast is not a ring
    expect(notify.has("crew:crew-bob")).toBe(true);
  });

  it("a priority message rings through even within the batch window", async () => {
    const repo = await seed();
    await post(repo, "m1", "slip changed to C", "2026-07-04T09:01:45.000Z", true); // 15s ago — inside window
    const r = await doorbellTick(repo, new InMemoryPresence(), NOW, RULES);
    expect(r.rings).toHaveLength(2);
    expect(r.rings.every((d) => d.reason === "priority_bypass")).toBe(true);
  });

  it("never rings inactive crew (membership respects the active gate)", async () => {
    const repo = await seed();
    await repo.saveCrewMember({ ...crew("crew-carol", "Carol"), status: "inactive" });
    await post(repo, "m1", "hi");
    const r = await doorbellTick(repo, new InMemoryPresence(), NOW, RULES);
    expect(r.decisions.some((d) => d.subject.id === "crew-carol")).toBe(false);
    expect(r.rings).toHaveLength(2); // alice + bob only
  });

  it("never rings the operator — a member by seat/roster, but excluded (#118, DEC-072)", async () => {
    const repo = await seed();
    // The operator is a real, active roster crew member (operator-as-crew, DEC-030),
    // so all-staff membership includes them — but the doorbell must not ring them.
    await repo.saveCrewMember(crew("crew-operator", "Spink"));
    await post(repo, "m1", "hi");
    const r = await doorbellTick(repo, new InMemoryPresence(), NOW, RULES, "crew-operator");
    expect(r.decisions.some((d) => d.subject.id === "crew-operator")).toBe(false);
    expect(r.rings).toHaveLength(2); // alice + bob only — the operator is not rung
  });

  it("sweeps only threads that have messages", async () => {
    const repo = await seed(); // thread saved, but no messages posted
    const r = await doorbellTick(repo, new InMemoryPresence(), NOW, RULES);
    expect(r.threadsSwept).toBe(0);
    expect(r.decisions).toHaveLength(0);
  });
});
