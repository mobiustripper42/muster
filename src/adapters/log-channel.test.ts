import { describe, expect, it } from "vitest";
import { hashSecret } from "../auth/magic-link.js";
import { asId } from "../domain/ids.js";
import type { OutboundMessage } from "../ports/channel.js";
import type { AssignmentNotice } from "../ports/notice.js";
import type { NotificationMessage } from "../ports/notification.js";
import { InMemoryRepository } from "./in-memory-repository.js";
import { RELAY_LINK_TTL_MS } from "../ports/channel.js";
import { LogChannel } from "./log-channel.js";

/**
 * The replacement for the three outbox adapters (#934).
 *
 * What these pin is that all three ports still work through ONE class, and that the
 * logged line is usable rather than merely descriptive — the magic link is the whole
 * difference between this and a `console.log`.
 */

const T0 = new Date("2026-07-01T12:00:00.000Z");
const CREW = asId<"CrewMemberId">("crew-a");

const chan = (lines: string[]) =>
  new LogChannel(new InMemoryRepository(), {
    linkBase: "https://x.test/",
    now: () => T0,
    mintSecret: () => "s3cret",
    sink: (l) => lines.push(l),
    mintLink: true,
  });

const ask = (): OutboundMessage => ({
  to: { crewMemberId: CREW, phone: "+15555550100" },
  kind: "ask",
  body: "Muster: Sat, Jul 4 · Hops · captain — yes or no?",
  seatId: asId<"SeatId">("seat-1"),
  askId: asId<"AskId">("ask-1"),
});

const notice = (): AssignmentNotice => ({
  to: { crewMemberId: CREW, phone: "+15555550100" },
  action: "added",
  shiftId: asId<"ShiftId">("shift-1"),
  body: "You're on the Sat, Jul 4 Hops shift.",
});

const ring = (): NotificationMessage => ({
  to: { crewMemberId: CREW, phone: "+15555550100" },
  threadId: asId<"ThreadId">("thread-1"),
  mode: "content",
  body: "New message from the office.",
  messageIds: [asId<"MessageId">("msg-1")],
});

describe("LogChannel", () => {
  it("carries the body VERBATIM — a summarised ask is not an ask", async () => {
    const lines: string[] = [];
    await chan(lines).send(ask());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Muster: Sat, Jul 4 · Hops · captain — yes or no?");
  });

  it("says NOT SENT, and names who it was for", async () => {
    const lines: string[] = [];
    await chan(lines).send(ask());
    // This runs precisely when nothing left the building. A line that reads like a send
    // is worse than no line.
    expect(lines[0]).toContain("NOT SENT");
    expect(lines[0]).toContain("crew-a");
    expect(lines[0]).toContain("+15555550100");
  });

  it("mints a REAL magic link, not a placeholder", async () => {
    // The point of the class. A logged ask you cannot answer would describe the outbox
    // rather than replace it — so the secret in the line must be a live token.
    const repo = new InMemoryRepository();
    const lines: string[] = [];
    const c = new LogChannel(repo, {
      linkBase: "https://x.test",
      now: () => T0,
      mintSecret: () => "s3cret",
      sink: (l) => lines.push(l),
      mintLink: true,
    });
    await c.send(ask());

    expect(lines[0]).toContain("https://x.test/crew/auth?t=s3cret");
    const token = await repo.getMagicTokenByHash(hashSecret("s3cret"));
    expect(token).toMatchObject({ subjectKind: "crew", subjectId: CREW });
    // The relay TTL (24h — the ask's answer window), not the 15-minute dev-link one.
    expect(token!.expiresAt).toBe(new Date(T0.getTime() + RELAY_LINK_TTL_MS).toISOString());
  });

  it("serves all THREE ports from one send, discriminated by payload shape", async () => {
    // Same discrimination as `TwilioChannel` — `threadId` ⇒ ring, `action` ⇒ notice,
    // else ask. Getting this wrong swaps two messages that read nothing alike.
    const lines: string[] = [];
    const c = chan(lines);
    await c.send(ask());
    await c.send(notice());
    await c.send(ring());

    expect(lines[0]).toContain("[channel:ask]");
    expect(lines[1]).toContain("[channel:notice:added]");
    expect(lines[2]).toContain("[channel:ring]");
  });

  it("deep-links a ring into its thread, and does NOT do so for the other two", async () => {
    const lines: string[] = [];
    const c = chan(lines);
    await c.send(ring());
    await c.send(ask());
    // A ring that lands on the shift list instead of the message is a different message.
    expect(lines[0]).toContain("&thread=thread-1");
    expect(lines[1]).not.toContain("&thread=");
  });

  it("reports a ref that cannot be mistaken for a transmission", async () => {
    const res = await chan([]).send(ask());
    expect(res.ref).toBe("logged-ask");
    expect(res.deliveredAt).toBe(T0.toISOString());
  });

  it("degrades for a GUEST recipient rather than throwing, exactly as TwilioChannel does", async () => {
    // `@code-review` on #934: the first draft called `requireCrewId` before the dispatch,
    // so every message needed a crew id. `TwilioChannel` only requires one in its crew
    // branches — a receipt to a booking customer has no crew id at all (DEC-122). Two
    // adapters at the same port type must not disagree about who they accept.
    const lines: string[] = [];
    await chan(lines).send({
      to: { email: "guest@x.test", phone: "+15555559999" },
      kind: "receipt",
      body: "Your booking is confirmed.",
      link: "https://x.test/b/ABC123",
    });
    expect(lines[0]).toContain("[channel:receipt]");
    expect(lines[0]).toContain("guest@x.test");
    // The composed link is passed through, NOT replaced by a freshly minted crew link.
    expect(lines[0]).toContain("https://x.test/b/ABC123");
    expect(lines[0]).not.toContain("/crew/auth?t=");
  });

  it("honours a pre-composed link on an ask instead of minting over it", async () => {
    const lines: string[] = [];
    await chan(lines).send({ ...ask(), link: "https://x.test/already-minted" });
    expect(lines[0]).toContain("https://x.test/already-minted");
    expect(lines[0]).not.toContain("t=s3cret");
  });

  it("mints NOTHING by default — the safe value is the one you get by forgetting", async () => {
    // `/security-review` on #934, High/8: the logged link is a credential, and for
    // `OPERATOR_CREW_MEMBER_ID` an admin one — that crew id is an active admin (DEC-092)
    // and `switchToAdmin` upgrades a crew session with no re-auth. In production the sink
    // is `console.error`, a stream log-read access alone can reach.
    const repo = new InMemoryRepository();
    const lines: string[] = [];
    const c = new LogChannel(repo, {
      linkBase: "https://x.test",
      now: () => T0,
      mintSecret: () => "s3cret",
      sink: (l) => lines.push(l),
      // mintLink deliberately absent
    });
    await c.send(ask());

    expect(lines[0]).toContain("Muster: Sat, Jul 4 · Hops · captain — yes or no?");
    expect(lines[0]).not.toContain("/crew/auth?t=");
    expect(lines[0]).toContain("no sign-in link minted");
    // And no unredeemed 24h token left behind — skipped, not merely hidden.
    expect(await repo.getMagicTokenByHash(hashSecret("s3cret"))).toBeNull();
  });

  it("says so when the crew member has no phone on file", async () => {
    // Different failure from an unconfigured channel, and the line has to tell them apart.
    const lines: string[] = [];
    await chan(lines).send({ ...ask(), to: { crewMemberId: CREW } });
    expect(lines[0]).toContain("no phone on file");
  });
});
