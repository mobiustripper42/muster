import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { NotificationMessage } from "../ports/notification.js";
import { FakeNotificationChannel } from "./fake-notification-channel.js";

const ring = (over: Partial<NotificationMessage> = {}): NotificationMessage => ({
  to: { crewMemberId: asId<"CrewMemberId">("crew-a"), phone: "555" },
  threadId: asId<"ThreadId">("thread-sat"),
  mode: "summary",
  body: "3 new in Saturday cohort",
  messageIds: [asId<"MessageId">("m-1")],
  ...over,
});

describe("FakeNotificationChannel", () => {
  it("records a ring instead of sending, with an injected stamp + stable ref", async () => {
    const ch = new FakeNotificationChannel(() => new Date("2026-07-04T12:00:00.000Z"));
    const r = await ch.send(ring());
    expect(r).toEqual({ deliveredAt: "2026-07-04T12:00:00.000Z", ref: "fake-nfy-0" });
    expect(ch.sent).toHaveLength(1);
    expect(ch.last()?.body).toBe("3 new in Saturday cohort");
  });

  it("sent is a copy — an earlier read doesn't grow under later sends", async () => {
    const ch = new FakeNotificationChannel();
    await ch.send(ring());
    const snapshot = ch.sent;
    await ch.send(ring({ body: "second" }));
    expect(snapshot).toHaveLength(1);
    expect(ch.sent).toHaveLength(2);
  });

  it("clear forgets the log", async () => {
    const ch = new FakeNotificationChannel();
    await ch.send(ring());
    ch.clear();
    expect(ch.sent).toHaveLength(0);
    expect(ch.last()).toBeUndefined();
  });
});
