import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { OutboundMessage } from "../ports/channel.js";
import { EmailChannel, RESEND_ENDPOINT, type FetchLike } from "./email-channel.js";

/** A recording fake fetch — captures the one request and returns a scripted response. */
function fakeFetch(
  response: { ok: boolean; status: number; body: string } = {
    ok: true,
    status: 200,
    body: '{"id":"resend-123"}',
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

const codeMessage = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({
  to: { crewMemberId: asId<"CrewMemberId">("crew-quint"), email: "quint@brewboat.test" },
  kind: "magic_link",
  body: "Your Muster sign-in code is 123456. It expires in 10 minutes.",
  ...over,
});

const opts = (fetch: FetchLike) => ({
  apiKey: "re_test_key",
  from: "Muster <crew@crew.brewcle.com>",
  fetch,
  now: () => new Date("2026-06-29T21:00:00.000Z"),
});

describe("EmailChannel", () => {
  it("POSTs the Resend shape: endpoint, bearer auth, from/to/subject/text", async () => {
    const { fetch, calls } = fakeFetch();
    const result = await new EmailChannel(opts(fetch)).send(codeMessage());

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const sent = JSON.parse(init.body);
    expect(sent).toEqual({
      from: "Muster <crew@crew.brewcle.com>",
      to: ["quint@brewboat.test"],
      subject: "Your Muster sign-in code",
      text: "Your Muster sign-in code is 123456. It expires in 10 minutes.",
    });

    // Audit ref = Resend's id; deliveredAt from the injected clock.
    expect(result).toEqual({
      deliveredAt: "2026-06-29T21:00:00.000Z",
      ref: "resend-123",
    });
  });

  it("throws when the recipient has no email (nothing sent)", async () => {
    const { fetch, calls } = fakeFetch();
    const noEmail = codeMessage({
      to: { crewMemberId: asId<"CrewMemberId">("crew-quint") },
    });
    await expect(new EmailChannel(opts(fetch)).send(noEmail)).rejects.toThrow(
      /recipient email/,
    );
    expect(calls).toHaveLength(0);
  });

  it("throws on a non-2xx from Resend, surfacing the status AND the detail", async () => {
    const { fetch } = fakeFetch({ ok: false, status: 422, body: '{"message":"bad from"}' });
    await expect(new EmailChannel(opts(fetch)).send(codeMessage())).rejects.toThrow(
      /Resend send failed \(422\):.*bad from/,
    );
  });

  it("a 2xx with an unparseable body still succeeds (ref undefined)", async () => {
    const { fetch } = fakeFetch({ ok: true, status: 200, body: "not json" });
    const result = await new EmailChannel(opts(fetch)).send(codeMessage());
    expect(result.ref).toBeUndefined();
    expect(result.deliveredAt).toBe("2026-06-29T21:00:00.000Z");
  });
});
