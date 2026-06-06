import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import {
  hashSecret,
  issueMagicLink,
  randomSecret,
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

describe("randomSecret", () => {
  it("produces distinct, URL-safe secrets", () => {
    const a = randomSecret();
    const b = randomSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
  });
});
