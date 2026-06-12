import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import {
  hashSecret,
  issueMagicLink,
  peekMagicLink,
  randomSecret,
  reapExpiredMagicLinks,
  verifyMagicLink,
} from "./magic-link.js";

const T0 = new Date("2026-07-01T12:00:00.000Z");
const TTL = 15 * 60_000; // 15 minutes

/** Deterministic secret generator for tests — a counter, not crypto. */
function counterSecrets(): () => string {
  let n = 0;
  return () => `secret-${n++}`;
}

describe("issueMagicLink", () => {
  it("stores only the hash; returns the raw secret; same mechanism admin + crew", async () => {
    const repo = new InMemoryRepository();
    const mintSecret = counterSecrets();

    const crewLink = await issueMagicLink(
      repo,
      { subjectKind: "crew", subjectId: "crew-a", ttlMs: TTL },
      { now: T0, mintSecret },
    );
    expect(crewLink.secret).toBe("secret-0");
    expect(crewLink.token.tokenHash).toBe(hashSecret("secret-0"));
    // The plaintext secret is never persisted — only its hash.
    const stored = await repo.getMagicTokenByHash(hashSecret("secret-0"));
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain("secret-0");
    expect(stored!.expiresAt).toBe("2026-07-01T12:15:00.000Z");
    expect("consumedAt" in stored!).toBe(false);

    const adminLink = await issueMagicLink(
      repo,
      { subjectKind: "admin", subjectId: "spink@brewboat.co", ttlMs: TTL },
      { now: T0, mintSecret },
    );
    expect(adminLink.token.subjectKind).toBe("admin");
  });
});

describe("verifyMagicLink", () => {
  it("redeems a live link once, returning the subject", async () => {
    const repo = new InMemoryRepository();
    const { secret } = await issueMagicLink(
      repo,
      { subjectKind: "crew", subjectId: "crew-a", ttlMs: TTL },
      { now: T0, mintSecret: counterSecrets() },
    );

    const result = await verifyMagicLink(repo, secret, { now: new Date(T0.getTime() + 1000) });
    expect(result).toEqual({ ok: true, subject: { kind: "crew", id: "crew-a" } });
  });

  it("is single-use: a second redemption fails as consumed", async () => {
    const repo = new InMemoryRepository();
    const { secret } = await issueMagicLink(
      repo,
      { subjectKind: "crew", subjectId: "crew-a", ttlMs: TTL },
      { now: T0, mintSecret: counterSecrets() },
    );
    await verifyMagicLink(repo, secret, { now: T0 });
    const second = await verifyMagicLink(repo, secret, { now: T0 });
    expect(second).toEqual({ ok: false, reason: "consumed" });
  });

  it("rejects an expired link", async () => {
    const repo = new InMemoryRepository();
    const { secret } = await issueMagicLink(
      repo,
      { subjectKind: "crew", subjectId: "crew-a", ttlMs: TTL },
      { now: T0, mintSecret: counterSecrets() },
    );
    const past = new Date(T0.getTime() + TTL); // exactly at expiry → dead
    expect(await verifyMagicLink(repo, secret, { now: past })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects an unknown secret", async () => {
    const repo = new InMemoryRepository();
    expect(await verifyMagicLink(repo, "never-issued", { now: T0 })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("exactly one of two concurrent taps wins (single-use CAS)", async () => {
    const repo = new InMemoryRepository();
    const { secret } = await issueMagicLink(
      repo,
      { subjectKind: "crew", subjectId: "crew-a", ttlMs: TTL },
      { now: T0, mintSecret: counterSecrets() },
    );
    const [a, b] = await Promise.all([
      verifyMagicLink(repo, secret, { now: T0 }),
      verifyMagicLink(repo, secret, { now: T0 }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe("peekMagicLink — the prefetch-safe GET landing (DEC-030)", () => {
  it("a GET-style peek does NOT consume: the human's tap still redeems after any number of previews", async () => {
    const repo = new InMemoryRepository();
    const { secret } = await issueMagicLink(
      repo,
      { subjectKind: "crew", subjectId: "crew-a", ttlMs: TTL },
      { now: T0, mintSecret: counterSecrets() },
    );

    // iMessage/Android preview bots GET the link — possibly several times.
    for (let i = 0; i < 3; i++) {
      const peek = await peekMagicLink(repo, secret, { now: T0 });
      expect(peek).toEqual({ ok: true, subject: { kind: "crew", id: "crew-a" } });
    }
    // Token untouched: still unconsumed in storage…
    const stored = await repo.getMagicTokenByHash(hashSecret(secret));
    expect("consumedAt" in stored!).toBe(false);
    // …so the human's explicit tap (the POST) still logs them in, single-use.
    const tap = await verifyMagicLink(repo, secret, { now: T0 });
    expect(tap.ok).toBe(true);
    const replay = await verifyMagicLink(repo, secret, { now: T0 });
    expect(replay).toEqual({ ok: false, reason: "consumed" });
  });

  it("returns the same precise failure reasons as verify, still without writing", async () => {
    const repo = new InMemoryRepository();
    expect(await peekMagicLink(repo, "never-issued", { now: T0 })).toEqual({
      ok: false,
      reason: "not_found",
    });

    const { secret } = await issueMagicLink(
      repo,
      { subjectKind: "crew", subjectId: "crew-a", ttlMs: TTL },
      { now: T0, mintSecret: counterSecrets() },
    );
    const atExpiry = new Date(T0.getTime() + TTL); // verify's exact boundary
    expect(await peekMagicLink(repo, secret, { now: atExpiry })).toEqual({
      ok: false,
      reason: "expired",
    });
    await verifyMagicLink(repo, secret, { now: T0 }); // consume it
    expect(await peekMagicLink(repo, secret, { now: T0 })).toEqual({
      ok: false,
      reason: "consumed",
    });
  });
});

describe("reapExpiredMagicLinks", () => {
  /** Issue a link expiring `ttlMs` after T0 and return its stored token id. */
  async function issueAt(repo: InMemoryRepository, subjectId: string, ttlMs: number) {
    const { token } = await issueMagicLink(
      repo,
      { subjectKind: "crew", subjectId, ttlMs },
      { now: T0, mintSecret: () => `secret-${subjectId}` },
    );
    return token.id;
  }

  it("deletes an expired token and leaves a live one", async () => {
    const repo = new InMemoryRepository();
    const dead = await issueAt(repo, "dead", TTL); // expires T0+15m
    const live = await issueAt(repo, "live", 2 * TTL); // expires T0+30m

    const at20m = new Date(T0.getTime() + 20 * 60_000);
    expect(await reapExpiredMagicLinks(repo, at20m)).toEqual({ reaped: 1 });

    const remaining = await repo.listAllMagicTokens();
    expect(remaining.map((t) => t.id)).toEqual([live]);
    void dead;
  });

  it("reaps at the expiry boundary (now === expiresAt), matching verify", async () => {
    const repo = new InMemoryRepository();
    await issueAt(repo, "edge", TTL);
    const atExpiry = new Date(T0.getTime() + TTL); // the instant the link goes dead
    expect(await reapExpiredMagicLinks(repo, atExpiry)).toEqual({ reaped: 1 });
    expect(await repo.listAllMagicTokens()).toHaveLength(0);
  });

  it("is a no-op on an empty store", async () => {
    const repo = new InMemoryRepository();
    expect(await reapExpiredMagicLinks(repo, T0)).toEqual({ reaped: 0 });
  });

  it("counts a mixed batch and leaves every still-live token", async () => {
    const repo = new InMemoryRepository();
    await issueAt(repo, "a", TTL); // dead by T0+20m
    await issueAt(repo, "b", TTL); // dead by T0+20m
    const liveC = await issueAt(repo, "c", 3 * TTL); // alive until T0+45m
    const liveD = await issueAt(repo, "d", 3 * TTL);

    const at20m = new Date(T0.getTime() + 20 * 60_000);
    expect(await reapExpiredMagicLinks(repo, at20m)).toEqual({ reaped: 2 });

    const ids = (await repo.listAllMagicTokens()).map((t) => t.id).sort();
    expect(ids).toEqual([liveC, liveD].sort());
  });
});

describe("randomSecret", () => {
  it("produces distinct, URL-safe secrets", () => {
    const a = randomSecret();
    const b = randomSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
  });
});
