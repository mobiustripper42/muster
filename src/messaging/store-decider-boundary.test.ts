/**
 * Substrate ↔ consumer contract (#116, 6.6a). The read/notify state the store
 * persists must drop into `decideNotifications` and reproduce the decider's exact
 * first-only-until-read boundary (`lastNotifiedMs > lastReadMs`). Every 6.6a output
 * is unconsumed until 6.6b, so this fixture is what pins the storage semantics to
 * the consumer NOW — a wrong contract would otherwise surface only when the tick is
 * built on top, as the double-ring / silent-suppress the doorbell exists to prevent.
 *
 * It also exercises the exact re-key the 6.6b tick will do: the store returns
 * `subjectKey`-keyed per-thread maps; the decider wants `memberThreadKey`-keyed.
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { Subject } from "../domain/entities.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import {
  decideNotifications,
  makeDoorbellRules,
  memberThreadKey,
  type NotificationDecision,
  type PendingMessage,
} from "./doorbell-decider.js";

const T = asId<"ThreadId">("thread-sat");
const ALICE = asId<"CrewMemberId">("crew-alice");
const aliceSubject: Subject = { kind: "crew", id: String(ALICE) };
const RULES = makeDoorbellRules({
  batchWindowMs: 90_000,
  presenceWindowMs: 300_000,
  shortNoticeMaxChars: 160,
});

const msg = (createdAt: string): PendingMessage => ({
  id: asId<"MessageId">(`m-${createdAt}`),
  threadId: T,
  senderId: "operator",
  senderKind: "admin",
  body: "dock at slip B",
  createdAt,
  priority: false,
});

/**
 * Compose the decider's `memberThreadKey`-keyed maps from the store's
 * `subjectKey`-keyed per-thread maps — exactly what 6.6b's tick will do. Presence
 * is left empty (absent → SMS-eligible) so the read/notify boundary is isolated.
 */
async function decideFromStore(
  repo: InMemoryRepository,
  messages: PendingMessage[],
  now: string,
): Promise<NotificationDecision[]> {
  const read = await repo.readStateForThread(T);
  const notify = await repo.notifyStateForThread(T);
  const readState = new Map<string, string>();
  const notifyState = new Map<string, string>();
  for (const [sk, at] of read) readState.set(`${T}|${sk}`, at);
  for (const [sk, at] of notify) notifyState.set(`${T}|${sk}`, at);
  return decideNotifications({
    pendingMessages: messages,
    threadMembers: new Map([[T, [ALICE]]]),
    presence: new Map(),
    readState,
    notifyState,
    rules: RULES,
    now,
  });
}

describe("stored read/notify state → decider boundary (#116)", () => {
  it("the tick's re-key matches the decider's own memberThreadKey", () => {
    expect(`${T}|crew:${ALICE}`).toBe(memberThreadKey(T, aliceSubject));
  });

  it("a recorded notification suppresses the next sweep (first-only-until-read)", async () => {
    const repo = new InMemoryRepository();
    await repo.recordNotification(T, aliceSubject, "2026-07-04T11:59:00.000Z");
    const ds = await decideFromStore(
      repo,
      [msg("2026-07-04T11:58:00.000Z")],
      "2026-07-04T12:00:00.000Z",
    );
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ ring: false, reason: "already_notified" });
  });

  it("a later recorded read re-arms the ring (lastNotified < lastRead)", async () => {
    const repo = new InMemoryRepository();
    await repo.recordNotification(T, aliceSubject, "2026-07-04T11:55:00.000Z");
    await repo.recordRead(T, aliceSubject, "2026-07-04T11:56:00.000Z");
    const ds = await decideFromStore(
      repo,
      [msg("2026-07-04T11:58:00.000Z")], // fresh message after the read, aged past the window
      "2026-07-04T12:00:00.000Z",
    );
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ ring: true, reason: "batched" });
  });
});
