import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import {
  FAILURE_WINDOW_MS,
  MAX_ATTEMPTS,
  MAX_FAILURES_PER_WINDOW,
  RESEND_COOLDOWN_MS,
  normalizeEmail,
  randomCode,
  requestLoginCode,
  verifyLoginCode,
} from "./login-code.js";

/** The one failure `verifyLoginCode` can return. Named so the tests read as the property
 *  they're asserting: not "this branch says X", but "every branch says the same thing". */
const FAILED = { ok: false, reason: "invalid" } as const;

const CAPTAIN = asId<"RoleTypeId">("captain");
const EMAIL = "Quint@BB.test"; // stored mixed-case on purpose
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
      { email: "  quint@bb.test  " },
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
    expect(last).toEqual(FAILED);
    // The real code is now dead too — the cap still holds, it just doesn't announce itself.
    expect(await verifyLoginCode(repo, { email: EMAIL, code }, { now: at(2000) })).toEqual(FAILED);
  });

  it("an expired code fails identically to a wrong one", async () => {
    const repo = await repoWithCrew();
    const code = await mintFor(repo, EMAIL, "123456", at(0));
    const r = await verifyLoginCode(repo, { email: EMAIL, code }, { now: at(11 * 60_000) });
    expect(r).toEqual(FAILED);
  });

  it("is invalid for a non-matching email (no code exists)", async () => {
    const repo = await repoWithCrew();
    const r = await verifyLoginCode(
      repo,
      { email: "stranger@nope.test", code: "123456" },
      { now: at(1000) },
    );
    expect(r).toEqual(FAILED);
  });

  // THE test this module was missing (#522 sweep 2). Two tests used to sit twelve lines
  // apart pinning "known email → expired" and "unknown email → invalid" as the contract —
  // which is a roster oracle stated as a requirement. Every failure is now one value, and
  // this asserts the property directly rather than leaving it implied by three assertions
  // that happen to match.
  it("NO ENUMERATION: every failure mode is byte-identical, on-roster or not", async () => {
    const known = async (setup: (repo: InMemoryRepository) => Promise<unknown>, now: number) => {
      const repo = await repoWithCrew();
      await setup(repo);
      return verifyLoginCode(repo, { email: EMAIL, code: "000000" }, { now: at(now) });
    };

    const results = [
      // Unknown email — the attacker's control case.
      await (async () => {
        const repo = await repoWithCrew();
        return verifyLoginCode(repo, { email: "stranger@nope.test", code: "000000" }, { now: at(1) });
      })(),
      // On-roster, no code ever minted.
      await known(async () => {}, 1),
      // On-roster, code expired.
      await known((r) => mintFor(r, EMAIL, "123456", at(0)), 11 * 60_000),
      // On-roster, code consumed.
      await known(async (r) => {
        const code = await mintFor(r, EMAIL, "123456", at(0));
        await verifyLoginCode(r, { email: EMAIL, code }, { now: at(1) });
      }, 2),
      // On-roster, locked at the per-code cap.
      await known(async (r) => {
        await mintFor(r, EMAIL, "123456", at(0));
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          await verifyLoginCode(r, { email: EMAIL, code: "999999" }, { now: at(1 + i) });
        }
      }, 100),
    ];

    for (const r of results) expect(r).toEqual(FAILED);
    // Not just equal-shaped: one distinct serialization across every branch.
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("the per-subject window survives re-mints, so mint-guess-mint can't run forever", async () => {
    // The brute-force hole (DEC-142): MAX_ATTEMPTS caps guesses per CODE, and a re-mint
    // reset it — ~7,200 guesses/day against a 6-digit space, in parallel across the whole
    // roster. Admins are crew (DEC-092) and a crew session escalates to the cockpit in one
    // click, so the prize was the operator account.
    const repo = await repoWithCrew();
    let clock = 0;
    let failures = 0;

    // Burn the window the way an attacker would: mint, exhaust the per-code cap, re-mint.
    while (failures < MAX_FAILURES_PER_WINDOW) {
      await mintFor(repo, EMAIL, String(failures).padStart(6, "0"), at(clock));
      for (let i = 0; i < MAX_ATTEMPTS && failures < MAX_FAILURES_PER_WINDOW; i++) {
        await verifyLoginCode(repo, { email: EMAIL, code: "999999" }, { now: at(clock) });
        failures++;
      }
      clock += RESEND_COOLDOWN_MS + 1;
    }

    // A WRONG guess at the cap is still refused — the window still bounds brute force, which is
    // the whole point of DEC-142. This is the property that must not regress. (Advance past the
    // resend cooldown before each fresh mint, or the anti-spam guard suppresses it.)
    clock += RESEND_COOLDOWN_MS + 1;
    await mintFor(repo, EMAIL, "123456", at(clock));
    expect(await verifyLoginCode(repo, { email: EMAIL, code: "999999" }, { now: at(clock) })).toEqual(FAILED);

    // …but the CORRECT code redeems even at the cap (issue #801). Before this fix the window gate
    // sat AHEAD of the hash compare, so `claimLoginAttempt` returned null and the legitimate crew
    // member — holding the right code — got the same `invalid` as the attacker, locked out for 24h.
    // The window gates GUESSES, not the code itself.
    clock += RESEND_COOLDOWN_MS + 1;
    const code = await mintFor(repo, EMAIL, "424242", at(clock));
    expect(await verifyLoginCode(repo, { email: EMAIL, code }, { now: at(clock) })).toMatchObject({
      ok: true,
    });

    // And it still rolls: past the window, a fresh correct code redeems as before.
    const later = clock + FAILURE_WINDOW_MS + 1;
    const fresh = await mintFor(repo, EMAIL, "654321", at(later));
    expect(await verifyLoginCode(repo, { email: EMAIL, code: fresh }, { now: at(later) })).toMatchObject({
      ok: true,
    });
  });

  it("the window gates guesses, not codes: correct code wins at the cap, wrong code still loses (#801)", async () => {
    const repo = await repoWithCrew();
    // Drive the window to exactly the cap with wrong guesses across re-mints, same as above but
    // isolated so the assertions read cleanly.
    let clock = 0;
    let failures = 0;
    while (failures < MAX_FAILURES_PER_WINDOW) {
      await mintFor(repo, EMAIL, String(failures).padStart(6, "0"), at(clock));
      for (let i = 0; i < MAX_ATTEMPTS && failures < MAX_FAILURES_PER_WINDOW; i++) {
        await verifyLoginCode(repo, { email: EMAIL, code: "999999" }, { now: at(clock) });
        failures++;
      }
      clock += RESEND_COOLDOWN_MS + 1;
    }

    // A correct login at the cap must NOT count as a window failure — a success is not a guess.
    // Mint a fresh code, redeem it correctly, then prove a second fresh code still redeems: if the
    // success had advanced the window it would now be over the cap and the second correct code
    // would be (wrongly) refused.
    const code1 = await mintFor(repo, EMAIL, "111222", at(clock));
    expect((await verifyLoginCode(repo, { email: EMAIL, code: code1 }, { now: at(clock) })).ok).toBe(true);

    clock += RESEND_COOLDOWN_MS + 1;
    const code2 = await mintFor(repo, EMAIL, "333444", at(clock));
    expect((await verifyLoginCode(repo, { email: EMAIL, code: code2 }, { now: at(clock) })).ok).toBe(true);
  });

  it("a code already at MAX_ATTEMPTS stays dead even to a correct guess (DEC-081 unchanged, #801)", async () => {
    const repo = await repoWithCrew();
    const code = await mintFor(repo, EMAIL, "246810", at(0));
    // Burn the per-code attempt ceiling with wrong guesses (well under the window cap).
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await verifyLoginCode(repo, { email: EMAIL, code: "999999" }, { now: at(i) });
    }
    // The 6th submission is the CORRECT code — still refused. The window fix only bypasses the
    // WINDOW gate for a correct code; the per-code `attempts < MAX_ATTEMPTS` ceiling stays an
    // independent AND, so a code that already absorbed 5 guesses is spent regardless.
    expect(await verifyLoginCode(repo, { email: EMAIL, code }, { now: at(MAX_ATTEMPTS) })).toEqual(FAILED);
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
