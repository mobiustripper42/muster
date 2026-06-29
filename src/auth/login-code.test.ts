import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import {
  MAX_ATTEMPTS,
  normalizeEmail,
  randomCode,
  requestLoginCode,
  verifyLoginCode,
} from "./login-code.js";

const CAPTAIN = asId<"RoleTypeId">("captain");
const EMAIL = "Quint@BrewBoat.test"; // stored mixed-case on purpose
const BASE = Date.parse("2026-06-29T12:00:00Z");
const at = (ms = 0) => new Date(BASE + ms);
const fixedCode = (code: string) => () => code;

async function repoWithCrew(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveCrewMember({
    id: asId<"CrewMemberId">("crew-quint"),
    name: "Quint",
    phone: "+15550001",
    email: EMAIL,
    ratings: [CAPTAIN],
    status: "active",
    reliabilityScore: null,
  });
  return repo;
}

/** Drive request → return the minted code (fails the test if it didn't deliver). */
async function mintFor(
  repo: InMemoryRepository,
  email: string,
  code = "123456",
  now = at(),
): Promise<string> {
  const r = await requestLoginCode(
    repo,
    { email },
    { now, mintCode: fixedCode(code) },
  );
  if (r.outcome !== "deliver") throw new Error("expected delivery");
  return r.code;
}

describe("requestLoginCode", () => {
  it("mints + asks to deliver for a matching email", async () => {
    const repo = await repoWithCrew();
    const r = await requestLoginCode(
      repo,
      { email: EMAIL },
      { now: at(), mintCode: fixedCode("123456") },
    );
    expect(r).toMatchObject({
      outcome: "deliver",
      recipientEmail: EMAIL,
      recipientName: "Quint",
      code: "123456",
      subject: { kind: "crew", id: "crew-quint" },
    });
    const stored = await repo.getLoginCode("crew", "crew-quint");
    expect(stored?.codeHash).toBeTruthy();
    expect(stored?.attempts).toBe(0);
  });

  it("matches case-insensitively and trims whitespace", async () => {
    const repo = await repoWithCrew();
    const r = await requestLoginCode(
      repo,
      { email: "  quint@brewboat.test  " },
      { now: at(), mintCode: fixedCode("123456") },
    );
    expect(r.outcome).toBe("deliver");
  });

  it("skips (no leak, no persist) for an unknown email", async () => {
    const repo = await repoWithCrew();
    const r = await requestLoginCode(
      repo,
      { email: "stranger@nope.test" },
      { now: at(), mintCode: fixedCode("123456") },
    );
    expect(r.outcome).toBe("skip");
    expect(await repo.getLoginCode("crew", "crew-quint")).toBeNull();
  });

  it("suppresses a re-mint inside the cooldown, then allows it after", async () => {
    const repo = await repoWithCrew();
    await mintFor(repo, EMAIL, "111111", at(0));
    const within = await requestLoginCode(
      repo,
      { email: EMAIL },
      { now: at(30_000), mintCode: fixedCode("222222") },
    );
    expect(within.outcome).toBe("skip");
    // The first code still stands (verifies); the cooldown one was discarded.
    expect((await verifyLoginCode(repo, { email: EMAIL, code: "111111" }, { now: at(31_000) })).ok)
      .toBe(true);

    // Past the cooldown a fresh request re-mints.
    const after = await requestLoginCode(
      repo,
      { email: EMAIL },
      { now: at(120_000), mintCode: fixedCode("333333") },
    );
    expect(after.outcome).toBe("deliver");
  });
});

describe("verifyLoginCode", () => {
  it("accepts the right code once, then refuses it (single-use)", async () => {
    const repo = await repoWithCrew();
    const code = await mintFor(repo, EMAIL);
    const first = await verifyLoginCode(repo, { email: EMAIL, code }, { now: at(1000) });
    expect(first).toEqual({ ok: true, subject: { kind: "crew", id: "crew-quint" } });
    const replay = await verifyLoginCode(repo, { email: EMAIL, code }, { now: at(2000) });
    expect(replay).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a wrong code and counts it against the cap", async () => {
    const repo = await repoWithCrew();
    await mintFor(repo, EMAIL, "123456");
    const bad = await verifyLoginCode(repo, { email: EMAIL, code: "000000" }, { now: at(1000) });
    expect(bad).toEqual({ ok: false, reason: "invalid" });
    expect((await repo.getLoginCode("crew", "crew-quint"))?.attempts).toBe(1);
  });

  it("locks after the attempt ceiling — even a correct code can't redeem", async () => {
    const repo = await repoWithCrew();
    const code = await mintFor(repo, EMAIL, "123456");
    let last;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      last = await verifyLoginCode(repo, { email: EMAIL, code: "000000" }, { now: at(1000 + i) });
    }
    expect(last).toEqual({ ok: false, reason: "locked" });
    // The real code is now dead too.
    expect(await verifyLoginCode(repo, { email: EMAIL, code }, { now: at(2000) }))
      .toEqual({ ok: false, reason: "locked" });
  });

  it("treats an expired code as expired", async () => {
    const repo = await repoWithCrew();
    const code = await mintFor(repo, EMAIL, "123456", at(0));
    const r = await verifyLoginCode(repo, { email: EMAIL, code }, { now: at(11 * 60_000) });
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("is invalid for a non-matching email (no code exists)", async () => {
    const repo = await repoWithCrew();
    const r = await verifyLoginCode(
      repo,
      { email: "stranger@nope.test", code: "123456" },
      { now: at(1000) },
    );
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("helpers", () => {
  it("normalizeEmail trims + lowercases", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
  it("randomCode is always 6 digits", () => {
    for (let i = 0; i < 50; i++) expect(randomCode()).toMatch(/^\d{6}$/);
  });
});
