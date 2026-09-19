/**
 * The recipient union guard (DEC-122).
 */
import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import {
  ChannelSendError,
  describeSendFailure,
  requireCrewId,
  type Recipient,
} from "./channel.js";

describe("requireCrewId", () => {
  it("returns the id for a crew recipient", () => {
    const crew: Recipient = { crewMemberId: asId<"CrewMemberId">("cm-1") };
    expect(requireCrewId(crew)).toBe("cm-1");
  });

  it("throws LOUD for a guest recipient (never a silent undefined into a minted link)", () => {
    const guest: Recipient = { email: "guest@example.com", phone: "+15550001111" };
    expect(() => requireCrewId(guest)).toThrow(/crewMemberId/);
  });
});

/**
 * The redaction the relays depend on (#902).
 *
 * The property under test is what it does NOT return. A crew member's 6-digit sign-in
 * code, and — until issue #1030 retires ask links — a live magic link, are what we hand
 * the provider; its error body may quote either back, and every `forward-*` relay writes
 * this string to a production log. So `describeSendFailure` is a security boundary that
 * happens to look like a formatting helper, and it gets tested like one.
 */
describe("describeSendFailure", () => {
  const LEAK = "to=crew@bb.test code=482913 link=https://muster.app/crew/auth?t=s3cret";

  it("never returns the provider's message, which is where a credential would be", () => {
    const out = describeSendFailure(new ChannelSendError("Resend", 422, LEAK));
    expect(out).not.toContain("482913");
    expect(out).not.toContain("s3cret");
    expect(out).not.toContain("crew@bb.test");
  });

  it("keeps the status, which is the half that says what to do about it", () => {
    expect(describeSendFailure(new ChannelSendError("Twilio", 429, LEAK))).toContain("429");
  });

  it("gives an unexpected Error its type and nothing else", () => {
    // Nobody has reasoned about what an unmodelled error from inside a channel adapter
    // carries, so it gets the least that is still useful.
    const e = new TypeError(LEAK);
    expect(describeSendFailure(e)).toBe("TypeError");
  });

  it("survives a non-Error throw", () => {
    expect(describeSendFailure(LEAK)).toBe("unknown error type");
    expect(describeSendFailure(null)).toBe("unknown error type");
  });

  it("leaves the thrown error's own message intact for a caller that handles it", () => {
    // The narrowing is at the LOG, not at the throw — `email-channel.test.ts` pins the
    // message, and a caller that acts on the reason rather than logging it still gets one.
    expect(new ChannelSendError("Resend", 422, "bad from").message).toContain("bad from");
  });
});
