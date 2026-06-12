import { describe, expect, it } from "vitest";
import { buildSmsUrl, normalizePhone } from "./sms-deep-link.js";

// Pinned behaviors carried over from the Bushel original — if one of these
// changes, it's a deliberate behavior change, not a refactor.

describe("buildSmsUrl", () => {
  it("basic ASCII body", () => {
    expect(buildSmsUrl({ phone: "+12162025718", body: "Hello" })).toBe(
      "sms:+12162025718?body=Hello",
    );
  });

  it("spaces encode as %20 (not +)", () => {
    expect(buildSmsUrl({ phone: "+12162025718", body: "Hello world" })).toBe(
      "sms:+12162025718?body=Hello%20world",
    );
  });

  it("newlines encode as %0A (the body+link relay is two lines)", () => {
    expect(
      buildSmsUrl({ phone: "+12162025718", body: "Line one\nLine two" }),
    ).toBe("sms:+12162025718?body=Line%20one%0ALine%20two");
  });

  it("URL-reserved characters are percent-encoded", () => {
    expect(buildSmsUrl({ phone: "+12162025718", body: "a&b?c=d#e+f/g" })).toBe(
      "sms:+12162025718?body=a%26b%3Fc%3Dd%23e%2Bf%2Fg",
    );
  });

  it("a magic link in the body survives encoding round-trip", () => {
    const link = "http://mill-dev:3000/crew/auth?t=abc_-123";
    const url = buildSmsUrl({ phone: "+12162025718", body: `In or out?\n${link}` });
    expect(decodeURIComponent(url.split("?body=")[1]!)).toBe(`In or out?\n${link}`);
  });

  it("empty body still produces ?body= (consistent shape)", () => {
    expect(buildSmsUrl({ phone: "+12162025718", body: "" })).toBe(
      "sms:+12162025718?body=",
    );
  });

  it("empty phone produces sms:?body=… (never throws; caller validates)", () => {
    expect(buildSmsUrl({ phone: "", body: "hi" })).toBe("sms:?body=hi");
  });

  it("normalizes phone formatting in the URL", () => {
    expect(buildSmsUrl({ phone: "(216) 202-5718", body: "hi" })).toBe(
      "sms:2162025718?body=hi",
    );
  });
});

describe("normalizePhone", () => {
  it("strips parens, dashes, dots, and whitespace", () => {
    expect(normalizePhone("(216) 202-5718")).toBe("2162025718");
    expect(normalizePhone("216-202-5718")).toBe("2162025718");
    expect(normalizePhone("216.202.5718")).toBe("2162025718");
    expect(normalizePhone(" 216 202 5718 ")).toBe("2162025718");
  });

  it("preserves a leading +", () => {
    expect(normalizePhone("+1 216-202-5718")).toBe("+12162025718");
    expect(normalizePhone("+1 (216) 202-5718")).toBe("+12162025718");
  });

  it("a + only counts when it leads — interior + chars are stripped", () => {
    expect(normalizePhone("216+202+5718")).toBe("2162025718");
  });

  it("empty input → empty output (no throw)", () => {
    expect(normalizePhone("")).toBe("");
  });

  it("leading whitespace before + is tolerated", () => {
    expect(normalizePhone(" +1 216-202-5718")).toBe("+12162025718");
    expect(normalizePhone("\t+12162025718")).toBe("+12162025718");
  });

  it("extension digits glue onto the main number (pinned behavior, v1)", () => {
    // Non-digits are stripped wholesale, so `x123` becomes `123` and
    // concatenates into a wrong number. Crew phones are operator-entered
    // (DEC-010) and carry no extensions today; this test documents the gotcha
    // so ext-aware parsing is added deliberately if that ever changes.
    expect(normalizePhone("216-202-5718 x123")).toBe("2162025718123");
  });
});
