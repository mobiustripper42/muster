import { describe, expect, it, vi } from "vitest";
import { logUnsent, unsentLine } from "./unsent";

/**
 * The contract of the line that replaces the outbox (#933).
 *
 * The outbox's only remaining job was letting a human read a message that was
 * never sent. These cases pin the two things that made it useful — the body
 * VERBATIM, and who it was for — because a line that summarises either one is a
 * line you cannot paste a link out of.
 */
describe("unsentLine", () => {
  const BODY = "Your trip is confirmed. Manage it here: https://x.test/b/ABC123";

  it("carries the body VERBATIM, not a summary or a length", () => {
    // The whole point. In dev this is the test harness the outbox used to be, and
    // a clickable link that has been elided is no harness at all.
    expect(unsentLine("reservations:confirm", { phone: "+15550001111" }, BODY)).toContain(BODY);
  });

  it("names the surface, so two senders are not one line in the log", () => {
    expect(unsentLine("reservations:resend", { phone: "+15550001111" }, BODY)).toContain(
      "[reservations:resend]",
    );
  });

  it("says NOT SENT in those words", () => {
    // A line that reads like a send is worse than no line: this path is reached
    // precisely when nothing left the building.
    expect(unsentLine("reservations:confirm", { phone: "+15550001111" }, BODY)).toContain(
      "NOT SENT",
    );
  });

  it("prints the recipient unmasked — phone, email, or both", () => {
    // Decided (#901): no masking. The line is server-side only, and a masked
    // recipient makes it useless for the one question it exists to answer.
    expect(unsentLine("s", { phone: "+15550001111" }, BODY)).toContain("+15550001111");
    expect(unsentLine("s", { email: "guest@x.test" }, BODY)).toContain("guest@x.test");

    const both = unsentLine("s", { phone: "+15550001111", email: "guest@x.test" }, BODY);
    expect(both).toContain("+15550001111");
    expect(both).toContain("guest@x.test");
  });

  it("says so when there is no recipient at all, rather than printing nothing", () => {
    // A reservation with neither contact is a different failure from an unconfigured
    // channel, and the line has to tell them apart.
    expect(unsentLine("s", {}, BODY)).toContain("no recipient");
  });
});

describe("logUnsent", () => {
  const BODY = "hello";

  it("writes one call to the sink, carrying the whole line", () => {
    const sink = vi.fn();
    logUnsent("s", { phone: "+15550001111" }, BODY, sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]?.[0]).toContain(BODY);
  });

  it("never throws, even when the sink does", () => {
    // It runs on a degrade path — the send already failed to happen. A logger that
    // throws here turns "nothing was sent" into a 500, which is strictly worse.
    // Same posture as `logSwallowed` (#854).
    const angry = () => {
      throw new Error("no console today");
    };
    expect(() => logUnsent("s", { phone: "+1" }, BODY, angry)).not.toThrow();
  });
});
