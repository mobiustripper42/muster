/**
 * TwilioChannel (9.4/#225, DEC-MSG-1 swap) — one class, three relay ports.
 * Asserts the Twilio request shape (endpoint, basic auth, form-encoded
 * To/From/Body) without a live send, the mint-at-send magic-link per port
 * (ask In/Out, notice sign-in, ring thread deep-link), and the port contract's
 * throw-on-reject (missing phone, non-2xx).
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "./in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { OutboundMessage } from "../ports/channel.js";
import type { AssignmentNotice } from "../ports/notice.js";
import type { NotificationMessage } from "../ports/notification.js";
import type { FetchLike } from "./email-channel.js";
import { TwilioChannel, twilioEndpoint } from "./twilio-channel.js";

/** A recording fake fetch — captures requests, returns a scripted response. */
function fakeFetch(
  response: { ok: boolean; status: number; body: string } = {
    ok: true,
    status: 201,
    body: '{"sid":"SM123"}',
  },
) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.body,
    };
  };
  return { fetch, calls };
}

const CREW = asId<"CrewMemberId">("crew-quint");
const NOW = new Date("2026-07-03T21:00:00.000Z");

function channel(fetch: FetchLike, repo = new InMemoryRepository()) {
  return new TwilioChannel(repo, {
    accountSid: "ACtest",
    authToken: "token-test",
    from: "+15005550006",
    linkBase: "https://muster.test",
    fetch,
    now: () => NOW,
    mintSecret: () => "s3cret",
  });
}

const ask = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({
  to: { crewMemberId: CREW, phone: "+15035550111" },
  kind: "ask",
  body: "Muster: Sat, Jul 4 · Hops · captain — in or out?",
  seatId: asId<"SeatId">("seat-1"),
  askId: asId<"AskId">("ask-1"),
  ...over,
});

describe("TwilioChannel", () => {
  it("POSTs the Twilio shape: account endpoint, basic auth, form To/From/Body", async () => {
    const { fetch, calls } = fakeFetch();
    const result = await channel(fetch).send(ask());

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(twilioEndpoint("ACtest"));
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("ACtest:token-test").toString("base64")}`,
    );
    expect(init.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );

    const form = new URLSearchParams(init.body);
    expect(form.get("To")).toBe("+15035550111");
    expect(form.get("From")).toBe("+15005550006");

    expect(result.ref).toBe("SM123");
    expect(result.deliveredAt).toBe(NOW.toISOString());
  });

  it("an ask SMS carries the body + a freshly minted In/Out magic link", async () => {
    const { fetch, calls } = fakeFetch();
    const repo = new InMemoryRepository();
    await channel(fetch, repo).send(ask());

    const body = new URLSearchParams(calls[0]!.init.body).get("Body")!;
    expect(body).toBe(
      "Muster: Sat, Jul 4 · Hops · captain — in or out?\n" +
        "https://muster.test/crew/auth?t=s3cret",
    );
  });

  it("an assignment notice appends the my-shifts sign-in link (DEC-084)", async () => {
    const { fetch, calls } = fakeFetch();
    const notice: AssignmentNotice = {
      to: { crewMemberId: CREW, phone: "+15035550111" },
      action: "removed",
      shiftId: asId<"ShiftId">("shift-hops"),
      body: "Muster: you're off the Sat, Jul 4 · Hops shift.",
    };
    await channel(fetch).send(notice);

    const body = new URLSearchParams(calls[0]!.init.body).get("Body")!;
    expect(body).toBe(
      "Muster: you're off the Sat, Jul 4 · Hops shift.\n" +
        "https://muster.test/crew/auth?t=s3cret",
    );
  });

  it("a doorbell ring deep-links into its thread (DEC-073)", async () => {
    const { fetch, calls } = fakeFetch();
    const ring: NotificationMessage = {
      to: { crewMemberId: CREW, phone: "+15035550111" },
      threadId: asId<"ThreadId">("thread-all-staff"),
      mode: "summary",
      body: "Muster: 3 new messages — tap to read.",
      messageIds: [asId<"MessageId">("msg-1")],
    };
    await channel(fetch).send(ring);

    const body = new URLSearchParams(calls[0]!.init.body).get("Body")!;
    expect(body).toBe(
      "Muster: 3 new messages — tap to read.\n" +
        "https://muster.test/crew/auth?t=s3cret&thread=thread-all-staff",
    );
  });

  it("throws on a missing recipient phone (port contract)", async () => {
    const { fetch, calls } = fakeFetch();
    await expect(
      channel(fetch).send(ask({ to: { crewMemberId: CREW } })),
    ).rejects.toThrow(/recipient phone/);
    expect(calls).toHaveLength(0);
  });

  it("throws on a non-2xx with the status, never echoing the link-bearing body", async () => {
    const { fetch } = fakeFetch({
      ok: false,
      status: 401,
      body: '{"message":"Authenticate"}',
    });
    await expect(channel(fetch).send(ask())).rejects.toThrow(
      /Twilio send failed \(401\)/,
    );
    // The thrown message must not leak the minted magic link.
    await expect(channel(fetch).send(ask())).rejects.not.toThrow(/t=s3cret/);
  });
});
