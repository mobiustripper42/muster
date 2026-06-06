import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { OutboundMessage } from "../ports/channel.js";
import { FakeChannel } from "./fake-channel.js";

const CREW = asId<"CrewMemberId">("crew-a");
const SEAT = asId<"SeatId">("seat-1");

const askMsg = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({
  to: { crewMemberId: CREW, phone: "555" },
  kind: "ask",
  body: "Can you run the 2pm?",
  seatId: SEAT,
  ...over,
});

describe("FakeChannel", () => {
  it("records sends in order and returns a deterministic stamp from the injected clock", async () => {
    const clock = new Date("2026-07-01T12:00:00.000Z");
    const ch = new FakeChannel(() => clock);

    const r1 = await ch.send(askMsg());
    const r2 = await ch.send(
      askMsg({ kind: "magic_link", body: "Tap to sign in", link: "https://m/abc" }),
    );

    expect(r1).toEqual({ deliveredAt: "2026-07-01T12:00:00.000Z", ref: "fake-0" });
    expect(r2.ref).toBe("fake-1");
    expect(ch.sent).toHaveLength(2);
    expect(ch.sent[0]!.kind).toBe("ask");
    expect(ch.last()!.kind).toBe("magic_link");
    expect(ch.last()!.link).toBe("https://m/abc");
  });

  it("ofKind filters; the magic link is retrievable for a dev to click", async () => {
    const ch = new FakeChannel(() => new Date("2026-07-01T12:00:00.000Z"));
    await ch.send(askMsg());
    await ch.send(askMsg({ kind: "magic_link", link: "https://m/xyz" }));

    const links = ch.ofKind("magic_link");
    expect(links).toHaveLength(1);
    expect(links[0]!.link).toBe("https://m/xyz");
  });

  it("sent is a copy — callers can't mutate the internal log", async () => {
    const ch = new FakeChannel(() => new Date("2026-07-01T12:00:00.000Z"));
    await ch.send(askMsg());
    (ch.sent as unknown as unknown[]).push("garbage");
    expect(ch.sent).toHaveLength(1);
  });

  it("clear empties the log", async () => {
    const ch = new FakeChannel(() => new Date("2026-07-01T12:00:00.000Z"));
    await ch.send(askMsg());
    ch.clear();
    expect(ch.sent).toHaveLength(0);
  });
});
