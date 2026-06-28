/**
 * The ring-outbox worklist (#118, DEC-073): drop-on-read (the ring leaves once the
 * recipient reads past enqueue), recency sort, pending/sent split, and name/phone
 * derived live from the crew record.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { CrewMember, Subject } from "../domain/entities.js";
import type { RingOutboxEntry } from "../domain/entities.js";
import { buildRingOutboxView } from "./ring-outbox-view.js";

const QUINT = asId<"CrewMemberId">("crew-quint");
const HOOPER = asId<"CrewMemberId">("crew-hooper");
const DEE = asId<"CrewMemberId">("crew-dee");

const crew = (id: typeof QUINT, name: string, phone: string): CrewMember => ({
  id,
  name,
  phone,
  ratings: [],
  status: "active",
  reliabilityScore: null,
});

const ring = (over: Partial<RingOutboxEntry> & Pick<RingOutboxEntry, "id" | "threadId" | "crewMemberId" | "createdAt">): RingOutboxEntry => ({
  body: "2 new messages",
  link: "https://app/crew/auth?t=s&thread=t",
  status: "pending",
  ...over,
});

describe("buildRingOutboxView (#118, DEC-073)", () => {
  it("drops read rings, keeps unread; recency desc; pending/sent split; live name+phone", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew(QUINT, "Quint", "555-0101"));
    await repo.saveCrewMember(crew(HOOPER, "Hooper", "")); // no phone
    await repo.saveCrewMember(crew(DEE, "Dee", "555-0103"));

    const tA = asId<"ThreadId">("thread-a");
    const tB = asId<"ThreadId">("thread-b");
    const tC = asId<"ThreadId">("thread-c");
    // Quint, thread A, pending, unread → shows.
    await repo.saveRingOutboxEntry(ring({ id: asId<"RingOutboxEntryId">("ring-a-quint"), threadId: tA, crewMemberId: QUINT, createdAt: "2026-07-04T09:00:00.000Z" }));
    // Hooper, thread B, pending, but READ past enqueue → dropped.
    await repo.saveRingOutboxEntry(ring({ id: asId<"RingOutboxEntryId">("ring-b-hooper"), threadId: tB, crewMemberId: HOOPER, createdAt: "2026-07-04T09:00:00.000Z" }));
    await repo.recordRead(tB, { kind: "crew", id: String(HOOPER) } as Subject, "2026-07-04T09:05:00.000Z");
    // Dee, thread C, SENT, newer, unread → shows in `sent`.
    await repo.saveRingOutboxEntry(ring({ id: asId<"RingOutboxEntryId">("ring-c-dee"), threadId: tC, crewMemberId: DEE, status: "sent", sentAt: "2026-07-04T09:10:00.000Z", createdAt: "2026-07-04T09:08:00.000Z" }));

    const view = await buildRingOutboxView(repo);

    expect(view.pending.map((c) => c.entryId)).toEqual(["ring-a-quint"]); // hooper dropped (read)
    expect(view.pending[0]).toMatchObject({ crewName: "Quint", crewPhone: "555-0101", body: "2 new messages" });
    expect(view.sent.map((c) => c.entryId)).toEqual(["ring-c-dee"]);
    expect(view.sent[0]).toMatchObject({ crewName: "Dee", sentAt: "2026-07-04T09:10:00.000Z" });
  });

  it("a no-phone crew yields crewPhone '' (the card flags it, doesn't crash)", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember(crew(HOOPER, "Hooper", ""));
    await repo.saveRingOutboxEntry(ring({ id: asId<"RingOutboxEntryId">("ring-x"), threadId: asId<"ThreadId">("t-x"), crewMemberId: HOOPER, createdAt: "2026-07-04T09:00:00.000Z" }));
    const view = await buildRingOutboxView(repo);
    expect(view.pending[0]!.crewPhone).toBe("");
  });
});
