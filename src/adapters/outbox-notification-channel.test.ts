/**
 * The doorbell-ring relay adapter (#118, DEC-073): `send` enqueues a ring outbox
 * entry with a thread deep-link, frozen at enqueue, and a re-ring upserts the one
 * slot (no duplicate worklist rows).
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import { InMemoryRepository } from "./in-memory-repository.js";
import { OutboxNotificationChannel } from "./outbox-notification-channel.js";
import type { NotificationMessage } from "../ports/notification.js";

const NOW = new Date("2026-07-04T09:00:00.000Z");

const ring = (body: string): NotificationMessage => ({
  to: { crewMemberId: asId<"CrewMemberId">("crew-quint"), phone: "555" },
  threadId: asId<"ThreadId">("thread-shift-1"),
  mode: "summary",
  body,
  messageIds: [],
});

describe("OutboxNotificationChannel (#118, DEC-073)", () => {
  it("enqueues a ring entry with a thread deep-link, deliveredAt = enqueue", async () => {
    const repo = new InMemoryRepository();
    const channel = new OutboxNotificationChannel(repo, {
      linkBase: "https://app.example/",
      now: () => NOW,
      mintSecret: () => "SECRET",
    });

    const res = await channel.send(ring("2 new messages"));

    const entries = await repo.listRingOutboxEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "ring-thread-shift-1-crew-quint",
      crewMemberId: "crew-quint",
      threadId: "thread-shift-1",
      body: "2 new messages",
      link: "https://app.example/crew/auth?t=SECRET&thread=thread-shift-1",
      status: "pending",
      createdAt: "2026-07-04T09:00:00.000Z",
    });
    expect(res).toEqual({ deliveredAt: "2026-07-04T09:00:00.000Z", ref: "ring-thread-shift-1-crew-quint" });
  });

  it("a re-ring (new cycle) upserts the SAME slot — no duplicate row", async () => {
    const repo = new InMemoryRepository();
    const channel = new OutboxNotificationChannel(repo, { linkBase: "https://app.example", now: () => NOW, mintSecret: () => "S" });
    await channel.send(ring("2 new messages"));
    await channel.send(ring("3 new messages"));
    const after = await repo.listRingOutboxEntries();
    expect(after).toHaveLength(1);
    expect(after[0]!.body).toBe("3 new messages");
  });
});
