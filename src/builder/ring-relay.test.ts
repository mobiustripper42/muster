/**
 * The doorbell-ring RELAY loop end-to-end (#118, DEC-073), over the in-memory repo:
 * post → `doorbellTick` → `forwardNotifications` through the REAL unconfigured-channel
 * adapter → a relayable line per absent crew member, each deep-linking into the thread.
 * The cron binds this same wiring to Postgres.
 *
 * **Half of this test was deleted with the outbox (#934), and that is a real loss.**
 * It used to continue: `buildRingOutboxView` surfaces the rings, and reading the thread
 * DROPS them from the worklist (drop-on-read). That was a property of the operator's
 * worklist, not of the domain — with no worklist there is nothing to drop from, and
 * `recordRead` no longer has a queue to affect. The decider half is still covered by
 * `src/messaging/doorbell-decider.test.ts`; what is gone is the end-to-end proof that a
 * ring stops being outstanding once its message is read.
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { CrewMember } from "../domain/entities.js";
import type { Message, Thread } from "../messaging/entities.js";
import { InMemoryPresence } from "../adapters/in-memory-presence.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { LogChannel } from "../adapters/log-channel.js";
import { forwardNotifications } from "../adapters/forward-notifications.js";
import { makeDoorbellRules } from "../messaging/doorbell-decider.js";
import { doorbellTick } from "./doorbell-tick.js";
import { RING_NOTIFICATION_BODY } from "../adapters/forward-notifications.js";

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
  it("post → tick → one relayable ring per absent crew member, deep-linked to the thread", async () => {
    const repo = await seed();
    const r = await doorbellTick(repo, new InMemoryPresence(), NOW, RULES);
    expect(r.rings).toHaveLength(2); // alice + bob, both absent

    const lines: string[] = [];
    const channel = new LogChannel(repo, {
      linkBase: "https://app.example",
      now: () => NOW,
      mintSecret: () => "SECRET",
      sink: (l) => lines.push(l),
    });
    const relayed = await forwardNotifications(repo, channel, r.rings);
    expect(relayed).toBe(2);

    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes("crew-alice"))).toBe(true);
    expect(lines.some((l) => l.includes("crew-bob"))).toBe(true);
    for (const line of lines) {
      // Bare ring body, NOT the note text (#387) — the ring says a message exists.
      expect(line).toContain(RING_NOTIFICATION_BODY);
      expect(line).toContain(`thread=${encodeURIComponent(String(THREAD))}`);
      expect(line).toContain("[channel:ring]");
    }
  });
});
