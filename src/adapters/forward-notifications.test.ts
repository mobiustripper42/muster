import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { CrewMember } from "../domain/entities.js";
import type { Message } from "../messaging/entities.js";
import type { NotificationDecision } from "../messaging/doorbell-decider.js";
import type { NotificationPort } from "../ports/notification.js";
import { FakeNotificationChannel } from "./fake-notification-channel.js";
import { forwardNotifications } from "./forward-notifications.js";
import { InMemoryRepository } from "./in-memory-repository.js";

const T = asId<"ThreadId">("thread-1");
const AT = (): Date => new Date("2026-07-04T12:00:00.000Z");

const crew = (id: string): CrewMember => ({
  id: asId<"CrewMemberId">(id),
  name: id,
  phone: `555-${id}`,
  ratings: [],
  status: "active",
  reliabilityScore: null,
});

const ring = (over: Partial<NotificationDecision> = {}): NotificationDecision => ({
  subject: { kind: "crew", id: "crew-a" },
  threadId: T,
  channel: "sms",
  ring: true,
  mode: "summary",
  reason: "batched",
  messageCount: 3,
  messageIds: [asId<"MessageId">("m1")],
  ...over,
});

describe("forwardNotifications", () => {
  it("every ring carries the bare 'You have a new Muster message' body (no count) (#387)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-a"));
    const ch = new FakeNotificationChannel(AT);
    const n = await forwardNotifications(repo, ch, [ring({ messageCount: 3, mode: "summary" })]);
    expect(n).toBe(1);
    expect(ch.last()?.body).toBe("You have a new Muster message"); // not "3 new messages"
    expect(ch.last()?.to.phone).toBe("555-crew-a"); // recipient resolved for the later real adapter
  });

  it("a content-mode ring does NOT inline the note's text into the SMS (#387)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-a"));
    const m: Message = {
      id: asId<"MessageId">("m1"),
      threadId: T,
      senderId: "operator",
      senderKind: "admin",
      body: "slip B, 12:30",
      createdAt: "2026-07-04T11:00:00.000Z",
      priority: false,
    };
    await repo.saveMessage(m);
    const ch = new FakeNotificationChannel(AT);
    await forwardNotifications(repo, ch, [ring({ mode: "content", messageIds: [m.id] })]);
    expect(ch.last()?.body).toBe("You have a new Muster message");
    expect(ch.last()?.body).not.toContain("slip B"); // the message text stays out of the SMS
  });

  it("swallows a per-ring send failure and forwards the rest (best-effort)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew("crew-a"));
    await repo.saveCrewMember(crew("crew-b"));
    let calls = 0;
    const flaky: NotificationPort = {
      async send() {
        calls += 1;
        if (calls === 1) throw new Error("medium rejected");
        return { deliveredAt: "2026-07-04T12:00:00.000Z", ref: "ok" };
      },
    };
    const n = await forwardNotifications(repo, flaky, [
      ring({ subject: { kind: "crew", id: "crew-a" } }),
      ring({ subject: { kind: "crew", id: "crew-b" } }),
    ]);
    expect(n).toBe(1); // first threw, second still forwarded
    expect(calls).toBe(2);
  });

  it("skips non-ring decisions and a dangling crew ref (best-effort)", async () => {
    const repo = new InMemoryRepository(); // crew-a NOT saved → dangling
    const ch = new FakeNotificationChannel(AT);
    const n = await forwardNotifications(repo, ch, [
      ring(), // crew-a missing → skipped, not thrown
      ring({ ring: false, mode: null, channel: "in_app_toast", reason: "present_toast" }), // toast → not a send
    ]);
    expect(n).toBe(0);
    expect(ch.sent).toHaveLength(0);
  });
});
