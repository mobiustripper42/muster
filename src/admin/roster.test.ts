/**
 * Roster view — credential health, cold-start standing, list-level render
 * (Task 1.1 / M0, SPEC §2.1).
 */

import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Credential } from "../domain/entities.js";
import {
  credentialHealth,
  EXPIRING_SOON_DAYS,
  healthOf,
} from "./credential-health.js";
import { buildRoster, renderRoster, standingOf } from "./roster.js";
import { seedBrewBoat } from "./seed-brewboat.js";

// Deliberately midnight UTC, which is 20:00 the PREVIOUS day in the tenant zone
// (America/New_York). Credential health reads a vessel-local "today" (#522 sweep 3,
// DEC-032), so for this instant that's 2026-06-03 — the adversarial value, kept as
// the default so a regression back to `toISOString().slice(0,10)` fails here.
const NOW = new Date("2026-06-04T00:00:00Z");
const NOW_LOCAL_DATE = "2026-06-03";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const cred = (expiry: string): Credential => ({
  id: asId<"CredentialId">(`cred-${expiry}`),
  crewMemberId: asId<"CrewMemberId">("crew-x"),
  type: "MMC",
  expiry,
});

describe("credential health", () => {
  it("classifies valid / expiring-soon / expired against the window", () => {
    expect(healthOf(cred("2029-01-01"), NOW)).toBe("valid");
    expect(healthOf(cred("2026-07-01"), NOW)).toBe("expiring_soon"); // 27 days
    expect(healthOf(cred("2026-01-01"), NOW)).toBe("expired");
  });

  it("treats the window boundary as still expiring-soon", () => {
    // Expressed as a DATE, the way the function compares. The old version built the
    // expiry as an instant `NOW + N days` and only landed on the boundary because NOW
    // happened to be exactly midnight UTC — it was testing the arithmetic against its
    // own construction rather than the rule.
    const onWindow = new Date(Date.parse(NOW_LOCAL_DATE) + EXPIRING_SOON_DAYS * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);
    expect(healthOf(cred(onWindow), NOW)).toBe("expiring_soon");
    // One day past the window is not.
    const pastWindow = new Date(
      Date.parse(NOW_LOCAL_DATE) + (EXPIRING_SOON_DAYS + 1) * MS_PER_DAY,
    )
      .toISOString()
      .slice(0, 10);
    expect(healthOf(cred(pastWindow), NOW)).toBe("valid");
  });

  it("uses a VESSEL-LOCAL today, so an evening read agrees with the oracle (#522)", () => {
    // The bug: `toISOString().slice(0,10)` rolled the day at 00:00Z, so between local
    // evening and UTC midnight this flagged a credential expired while the oracle —
    // comparing against a vessel-local trip date (DEC-032) — still seated the person.
    // NOW is 20:00 EDT on 2026-06-03; a credential expiring THAT day is still valid,
    // and `mmcValidOnDate("2026-06-03")` agrees.
    expect(healthOf(cred(NOW_LOCAL_DATE), NOW)).toBe("expiring_soon");
    expect(healthOf(cred(NOW_LOCAL_DATE), NOW)).not.toBe("expired");
    // The day before it is genuinely gone.
    expect(healthOf(cred("2026-06-02"), NOW)).toBe("expired");
  });

  it("takes the worst health across multiple credentials", () => {
    expect(
      credentialHealth([cred("2029-01-01"), cred("2026-01-01")], NOW),
    ).toBe("expired");
    expect(
      credentialHealth([cred("2029-01-01"), cred("2026-07-01")], NOW),
    ).toBe("expiring_soon");
  });

  it("is valid when there are no credentials", () => {
    expect(credentialHealth([], NOW)).toBe("valid");
  });
});

describe("standing", () => {
  it("reads cold-start (null score) as neutral with no-history note", () => {
    expect(standingOf(null)).toEqual({ band: "neutral", note: "no history yet" });
  });
});

describe("roster", () => {
  it("builds rows with resolved ratings, health, and cold-start standing", async () => {
    const repo = new InMemoryRepository();
    const seed = await seedBrewBoat(repo, NOW);
    const rows = await buildRoster(repo, seed.tenantId, NOW);

    expect(rows).toHaveLength(5);
    // Every seeded crew member is cold-start neutral.
    expect(rows.every((r) => r.standing.band === "neutral")).toBe(true);
    // Ratings resolved to role names, not raw ids.
    const voss = rows.find((r) => r.name === "Renata Voss");
    expect(voss?.ratings).toEqual(["mate"]);
    expect(voss?.credentialHealth).toBe("expired");
    // The seed deliberately spreads all three health states.
    const healths = new Set(rows.map((r) => r.credentialHealth));
    expect(healths).toEqual(new Set(["valid", "expiring_soon", "expired"]));
  });

  it("renders the credential-health flag at the list level", async () => {
    const repo = new InMemoryRepository();
    const seed = await seedBrewBoat(repo, NOW);
    const text = renderRoster(await buildRoster(repo, seed.tenantId, NOW));

    expect(text).toMatch(/Renata Voss.*credentials:EXPIRED/);
    expect(text).toMatch(/credentials:expiring-soon/);
    expect(text).toMatch(/credentials:valid/);
  });
});
