import { describe, expect, it } from "vitest";
import { hashSecret } from "../auth/magic-link.js";
import { asId } from "../domain/ids.js";
import type { OutboundMessage } from "../ports/channel.js";
import { InMemoryRepository } from "./in-memory-repository.js";
import { RELAY_LINK_TTL_MS, WebLinkChannel } from "./web-link-channel.js";

const T0 = new Date("2026-07-01T12:00:00.000Z");
const CREW = asId<"CrewMemberId">("crew-a");
const SEAT = asId<"SeatId">("seat-1");
const ASK = asId<"AskId">("ask-1");

const askMsg = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({
  to: { crewMemberId: CREW, phone: "+15555550100" },
  kind: "ask",
  body: "Muster: Sat, Jul 4 · Hops · captain — yes or no?",
  seatId: SEAT,
  askId: ASK,
  ...over,
});

function makeChannel(repo: InMemoryRepository) {
  let n = 0;
  return new WebLinkChannel(repo, {
    linkBase: "http://mill-dev:3000/", // trailing slash gets trimmed
    now: () => T0,
    mintSecret: () => `secret-${n++}`,
  });
}

describe("WebLinkChannel (DEC-030)", () => {
  it("send enqueues an OutboxEntry — pending, body verbatim, deliveredAt = enqueue time", async () => {
    const repo = new InMemoryRepository();
    const ch = makeChannel(repo);

    const result = await ch.send(askMsg());

    expect(result.deliveredAt).toBe("2026-07-01T12:00:00.000Z"); // enqueue IS delivery
    expect(result.ref).toBe("obx-ask-1");

    const [entry] = await repo.listOutboxEntries();
    expect(entry).toMatchObject({
      id: "obx-ask-1", // deterministic: one entry per ask
      askId: ASK,
      seatId: SEAT,
      crewMemberId: CREW,
      body: "Muster: Sat, Jul 4 · Hops · captain — yes or no?",
      link: "http://mill-dev:3000/crew/auth?t=secret-0",
      status: "pending",
      createdAt: "2026-07-01T12:00:00.000Z",
    });
    expect("sentAt" in entry!).toBe(false); // the operator hasn't texted yet
  });

  it("mints the magic link AT ENQUEUE: a real 24h crew token backs the stored link", async () => {
    const repo = new InMemoryRepository();
    const ch = makeChannel(repo);
    await ch.send(askMsg());

    // The stored link's secret resolves to a persisted token for the recipient…
    const token = await repo.getMagicTokenByHash(hashSecret("secret-0"));
    expect(token).toMatchObject({ subjectKind: "crew", subjectId: CREW });
    // …with the relay TTL (24h — the ask's answer window), not the dev 15min.
    expect(token!.expiresAt).toBe(
      new Date(T0.getTime() + RELAY_LINK_TTL_MS).toISOString(),
    );
    expect("consumedAt" in token!).toBe(false);
  });

  it("rejects a message without ask correlation — the pilot relays asks only", async () => {
    const repo = new InMemoryRepository();
    const ch = makeChannel(repo);
    await expect(
      ch.send(askMsg({ askId: undefined as never })),
    ).rejects.toThrow(/askId/);
    expect(await repo.listOutboxEntries()).toHaveLength(0);
    expect(await repo.listAllMagicTokens()).toHaveLength(0); // no orphan token
  });
});
