/**
 * buildNoticeOutboxView (DEC-084) — the "Assignment changes" relay view: pending vs
 * sent, recency-sorted, crew name/phone resolved. Terminal-on-sent (a sent notice
 * stays as the record — no drop-on-read).
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { buildNoticeOutboxView } from "./notice-outbox-view.js";
import { asId } from "../domain/ids.js";
import type { NoticeOutboxEntry } from "../domain/entities.js";

const CREW = asId<"CrewMemberId">("crew-bram");
const CAPTAIN = asId<"RoleTypeId">("role-captain");

const entry = (over: Partial<NoticeOutboxEntry>): NoticeOutboxEntry => ({
  id: asId<"NoticeOutboxEntryId">("notice-x"),
  crewMemberId: CREW,
  action: "removed",
  body: "Muster: you're off the Sat, Jul 4 · Barrel shift.",
  link: "https://app.example/crew/auth?t=s",
  status: "pending",
  createdAt: "2026-07-02T12:00:00.000Z",
  ...over,
});

describe("buildNoticeOutboxView (DEC-084)", () => {
  it("splits pending vs sent, resolves crew name/phone, sorts by recency", async () => {
    const repo = new InMemoryRepository();
    await repo.saveCrewMember({
      id: CREW,
      name: "Bram",
      phone: "+15555550101",
      ratings: [CAPTAIN],
      status: "active",
      reliabilityScore: null,
    });
    await repo.saveNoticeOutboxEntry(
      entry({ id: asId<"NoticeOutboxEntryId">("n-old"), createdAt: "2026-07-02T10:00:00.000Z" }),
    );
    await repo.saveNoticeOutboxEntry(
      entry({ id: asId<"NoticeOutboxEntryId">("n-new"), createdAt: "2026-07-02T12:00:00.000Z" }),
    );
    await repo.saveNoticeOutboxEntry(
      entry({
        id: asId<"NoticeOutboxEntryId">("n-sent"),
        status: "sent",
        sentAt: "2026-07-02T11:00:00.000Z",
        createdAt: "2026-07-02T09:00:00.000Z",
      }),
    );

    const view = await buildNoticeOutboxView(repo);
    // pending, newest first (terminal-on-sent keeps the sent one out of pending)
    expect(view.pending.map((c) => c.entryId)).toEqual(["n-new", "n-old"]);
    expect(view.sent.map((c) => c.entryId)).toEqual(["n-sent"]); // stays as the record
    expect(view.pending[0]!.crewName).toBe("Bram");
    expect(view.pending[0]!.crewPhone).toBe("+15555550101");
    expect(view.sent[0]!.sentAt).toBe("2026-07-02T11:00:00.000Z");
  });

  it("falls back to the crew id + empty phone when the crew record is missing", async () => {
    const repo = new InMemoryRepository();
    await repo.saveNoticeOutboxEntry(entry({}));
    const view = await buildNoticeOutboxView(repo);
    expect(view.pending[0]!.crewName).toBe(String(CREW));
    expect(view.pending[0]!.crewPhone).toBe("");
  });
});
