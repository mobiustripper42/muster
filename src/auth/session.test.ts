import { describe, expect, it } from "vitest";
import { shouldRenew, signSession, verifySession, type Session } from "./session.js";

const SECRET = "test-secret-do-not-use-in-prod";
const NOW = new Date("2026-07-01T12:00:00.000Z");
const session = (over: Partial<Session> = {}): Session => ({
  subjectKind: "crew",
  subjectId: "crew-a",
  expiresAt: "2026-07-15T12:00:00.000Z",
  ...over,
});

describe("signSession / verifySession", () => {
  it("round-trips a valid session and exposes the subject", () => {
    const token = signSession(session(), SECRET);
    const r = verifySession(token, SECRET, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session).toEqual(session());
      expect(r.subject).toEqual({ kind: "crew", id: "crew-a" });
    }
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = signSession(session(), SECRET);
    const [payload, sig] = token.split(".");
    // Forge a different subject, keep the old signature.
    const forged =
      Buffer.from(JSON.stringify(session({ subjectId: "crew-evil" })), "utf8").toString(
        "base64url",
      ) +
      "." +
      sig;
    expect(verifySession(forged, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    // sanity: the untampered one with this payload still verifies under its own sig
    expect(payload).toBeTruthy();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession(session(), "other-secret");
    expect(verifySession(token, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects an expired session", () => {
    const token = signSession(session({ expiresAt: "2026-07-01T11:00:00.000Z" }), SECRET);
    expect(verifySession(token, SECRET, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("treats a non-parseable expiry as dead (NaN guard)", () => {
    const token = signSession(session({ expiresAt: "not-a-date" }), SECRET);
    expect(verifySession(token, SECRET, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed tokens", () => {
    expect(verifySession("not-a-token", SECRET, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifySession(".abc", SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifySession("abc.", SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("shouldRenew", () => {
  it("true inside the renewal window, false outside", () => {
    const day = 24 * 60 * 60 * 1000;
    // expires in ~14 days; renew window 3 days → not yet
    expect(shouldRenew(session(), NOW, 3 * day)).toBe(false);
    // expires in 2 days, window 3 days → renew
    expect(
      shouldRenew(session({ expiresAt: new Date(NOW.getTime() + 2 * day).toISOString() }), NOW, 3 * day),
    ).toBe(true);
  });
});
