/**
 * OutboxNoticeChannel (DEC-084) — the pilot NoticePort: `send` enqueues a
 * NoticeOutboxEntry (deterministic id, frozen body + /crew link, pending) instead of
 * transmitting. Sibling of the ring channel's enqueue behaviour.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "./in-memory-repository.js";
import { OutboxNoticeChannel } from "./outbox-notice-channel.js";
import { asId } from "../domain/ids.js";

const CREW = asId<"CrewMemberId">("crew-bram");
const SHIFT = asId<"ShiftId">("shift-vessel-barrel-2026-07-04");

describe("OutboxNoticeChannel (DEC-084)", () => {
  it("enqueues a pending notice entry with a deterministic id + frozen body/link", async () => {
    const repo = new InMemoryRepository();
    const channel = new OutboxNoticeChannel(repo, {
      linkBase: "https://app.example/", // trailing slash trimmed
      now: () => new Date("2026-07-02T00:00:00.000Z"),
      mintSecret: () => "SECRET",
    });

    const res = await channel.send({
      to: { crewMemberId: CREW },
      action: "removed",
      shiftId: SHIFT,
      body: "Muster: you're off the Sat, Jul 4 · Barrel shift.",
    });

    const entries = await repo.listNoticeOutboxEntries();
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.id).toBe(`notice-${SHIFT}-${CREW}-removed`);
    expect(e.crewMemberId).toBe(CREW);
    expect(e.action).toBe("removed");
    expect(e.body).toBe("Muster: you're off the Sat, Jul 4 · Barrel shift.");
    expect(e.link).toBe("https://app.example/crew/auth?t=SECRET");
    expect(e.status).toBe("pending");
    expect(e.createdAt).toBe("2026-07-02T00:00:00.000Z");
    expect("sentAt" in e).toBe(false);
    expect(res).toEqual({ deliveredAt: e.createdAt, ref: e.id });
  });

  it("upserts one slot per (shift, member, action) — a re-send doesn't duplicate", async () => {
    const repo = new InMemoryRepository();
    const channel = new OutboxNoticeChannel(repo, {
      linkBase: "https://app.example",
      mintSecret: () => "S",
    });
    const notice = {
      to: { crewMemberId: CREW },
      action: "removed" as const,
      shiftId: SHIFT,
      body: "off",
    };
    await channel.send(notice);
    await channel.send(notice);
    expect(await repo.listNoticeOutboxEntries()).toHaveLength(1);
  });

  it("preserves a sent entry on re-send — doesn't reset the terminal record to pending", async () => {
    const repo = new InMemoryRepository();
    const channel = new OutboxNoticeChannel(repo, {
      linkBase: "https://app.example",
      mintSecret: () => "S",
    });
    const notice = {
      to: { crewMemberId: CREW },
      action: "removed" as const,
      shiftId: SHIFT,
      body: "off",
    };
    await channel.send(notice);
    // Operator marks it sent…
    const [e] = await repo.listNoticeOutboxEntries();
    await repo.saveNoticeOutboxEntry({
      ...e!,
      status: "sent",
      sentAt: "2026-07-02T01:00:00.000Z",
    });
    // …a re-merge of the same person must NOT reset it to pending (DEC-084).
    await channel.send(notice);
    const entries = await repo.listNoticeOutboxEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("sent");
    expect(entries[0]!.sentAt).toBe("2026-07-02T01:00:00.000Z");
  });
});
