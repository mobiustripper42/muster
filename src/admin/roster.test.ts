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

const NOW = new Date("2026-06-04T00:00:00Z");

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
    const onWindow = new Date(
      NOW.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(healthOf({ ...cred(onWindow.toISOString()) }, NOW)).toBe(
      "expiring_soon",
    );
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
