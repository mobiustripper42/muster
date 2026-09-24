import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSmsChannel } from "./sms";

/**
 * The one construction every SMS send site uses (#955).
 *
 * **Why this file exists at all.** Nine send sites each answered "what if Twilio is not
 * configured" for themselves, and got nine different answers: three routed to the console, two
 * did so only when email was ALSO missing, two discarded the message, two returned early. Not
 * one of the eight files holding those answers had a test — which is how nine answers to one
 * question got written without anything noticing.
 *
 * The fix is not a tenth answer. It is that there is nowhere left to put one: `makeSmsChannel`
 * never returns null, so a caller cannot degrade on its own initiative, and the nullable
 * constructor is no longer exported for a tenth site to find.
 *
 * `live` is the one distinction that survives, and it is NOT "should I send". It is "may I tell
 * a human this was sent" — DEC-170 is explicit that a log line is not a send and a caller must
 * never report success off the back of one.
 */

const TWILIO_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_FROM",
  "VERCEL_ENV",
  "NODE_ENV",
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const v of TWILIO_VARS) {
    saved.set(v, process.env[v]);
    delete process.env[v];
  }
});

afterEach(() => {
  for (const [v, was] of saved) {
    if (was === undefined) delete process.env[v];
    else process.env[v] = was;
  }
  saved.clear();
});

const BASE = "https://muster.test";

describe("makeSmsChannel", () => {
  it("returns a usable channel when Twilio is unset — never null", async () => {
    // The whole defect in one assertion. `makeTwilioChannel` returned null here, and every
    // caller had to decide what that meant. There is no null to decide about now.
    const { channel, live } = makeSmsChannel(BASE);
    expect(channel).toBeTruthy();
    expect(typeof channel.send).toBe("function");
    expect(live).toBe(false);
  });

  it("reports live when Twilio is fully configured", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "tok_test";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test";

    const { channel, live } = makeSmsChannel(BASE);
    expect(channel).toBeTruthy();
    expect(live).toBe(true);
  });

  it("redacts a booking code on a production deploy", async () => {
    // `/security-review` on #955: a customer receipt arrives with its link already composed into
    // the body, and a booking code is a credential. The flag is now `revealBookingCodes:
    // !isProdDeploy()`; it was `mintLink` until issue #1030 retired the crew magic link it was
    // first written for.
    process.env.VERCEL_ENV = "production";
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((l: unknown) => {
      errors.push(String(l));
    });

    try {
      const { channel, live } = makeSmsChannel(BASE);
      expect(live).toBe(false);
      await channel.send({
        to: { email: "mary@x.io", phone: "+15555550199" },
        kind: "receipt",
        body: `Your trip is confirmed. Manage it here: ${BASE}/b/0123456789ABCD`,
      });
    } finally {
      spy.mockRestore();
    }

    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain("0123456789ABCD");
    expect(errors[0]).toContain("/b/<redacted>");
    // Still a record: what did not go out, and to whom.
    expect(errors[0]).toContain("Your trip is confirmed.");
    expect(errors[0]).toContain("+15555550199");
  });

  it("treats a HALF-set Twilio config exactly like an unset one", async () => {
    // `sms.ts` already had this rule and it must survive the refactor: a half-set config with
    // SMS believed live is the state where every message silently goes nowhere.
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    // no auth token, no sender

    const { channel, live } = makeSmsChannel(BASE);
    expect(channel).toBeTruthy();
    expect(live).toBe(false);
  });
});
