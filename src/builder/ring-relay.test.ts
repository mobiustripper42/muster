/**
 * The doorbell-ring RELAY loop end-to-end (#118, DEC-073), over the in-memory repo:
 * post → `doorbellTick` → `forwardNotifications` through the REAL
 * `OutboxNotificationChannel` → ring entries enqueued with a thread deep-link →
 * `buildRingOutboxView` surfaces them → reading the thread DROPS them (drop-on-read).
 * The promotion gate's loop, the same wiring the cron binds to Postgres.
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { CrewMember, Subject } from "../domain/entities.js";
import type { Message, Thread } from "../messaging/entities.js";
import { InMemoryPresence } from "../adapters/in-memory-presence.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { OutboxNotificationChannel } from "../adapters/outbox-notification-channel.js";
import { forwardNotifications } from "../adapters/forward-notifications.js";
import { makeDoorbellRules } from "../messaging/doorbell-decider.js";
import { buildRingOutboxView } from "../admin/ring-outbox-view.js";
import { doorbellTick } from "./doorbell-tick.js";

const RULES = makeDoorbellRules({ batchWindowMs: 90_000, presenceWindowMs: 300_000, shortNoticeMaxChars: 160 });
const THREAD = asId<"ThreadId">("thread-all_staff-t1-all");
const NOW = new Date("2026-07-04T09:02:00.000Z");

const crew = (id: string, name: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name,
  phone: `555-${id}`,
  ratings: [],
  status: "active",
  reliabilityScore: null,
});

async function seed(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveCrewMember(crew("crew-alice", "Alice"));
  await repo.saveCrewMember(crew("crew-bob", "Bob"));
  const thread: Thread = { id: THREAD, tenantId: asId<"TenantId">("t1"), kind: "all_staff", scopeRef: null, createdAt: "2026-07-04T09:00:00.000Z" };
  await repo.saveThread(thread);
  // A PRIORITY message → rings now (bypasses the 90s batch window), so the loop is
  // deterministic without aging the clock.
  const m: Message = {
    id: asId<"MessageId">("m1"),
    threadId: THREAD,
    senderId: "operator",
    senderKind: "admin",
    body: "dock moved to slip C",
    createdAt: "2026-07-04T09:01:45.000Z",
    priority: true,
  };
  await repo.saveMessage(m);
  return repo;
}

describe("doorbell-ring relay loop (#118, DEC-073)", () => {
  it("post → tick → ring enqueued with a thread deep-link → view shows → read drops", async () => {
    const repo = await seed();
    const r = await doorbellTick(repo, new InMemoryPresence(), NOW, RULES);
    expect(r.rings).toHaveLength(2); // alice + bob, both absent

    const channel = new OutboxNotificationChannel(repo, {
      linkBase: "https://app.example",
      now: () => NOW,
      mintSecret: () => "SECRET",
    });
    const relayed = await forwardNotifications(repo, channel, r.rings);
    expect(relayed).toBe(2);

    // Two ring entries, each a deep-link into the thread (the §7.5 inlined content).
    let view = await buildRingOutboxView(repo);
    expect(view.pending.map((c) => c.crewName).sort()).toEqual(["Alice", "Bob"]);
    expect(view.pending[0]!.body).toBe("dock moved to slip C"); // single short note → content
    expect(view.pending[0]!.link).toContain(`thread=${encodeURIComponent(String(THREAD))}`);
    expect(view.sent).toHaveLength(0);

    // Alice taps the link → lands in the thread → the beacon marks read → her ring
    // drops from the worklist (DEC-073 drop-on-read). Bob's remains.
    await repo.recordRead(THREAD, { kind: "crew", id: "crew-alice" } as Subject, "2026-07-04T09:03:00.000Z");
    view = await buildRingOutboxView(repo);
    expect(view.pending.map((c) => c.crewName)).toEqual(["Bob"]);
  });
});
