/**
 * worstCredential (#57) — the which/when behind the credential-health band,
 * for the crew app's nudge line. Same window + date boundary as `healthOf`.
 */

import { describe, expect, it } from "vitest";
import { asId } from "../domain/ids.js";
import type { Credential } from "../domain/entities.js";
import { mmcValidOnDate } from "../oracle/eligibility.js";
import { healthOf, worstCredential } from "./credential-health.js";

const NOW = new Date("2026-07-01T12:00:00.000Z");

const cred = (id: string, type: Credential["type"], expiry: string): Credential => ({
  id: asId<"CredentialId">(id),
  crewMemberId: asId<"CrewMemberId">("crew-x"),
  type,
  expiry,
});

describe("worstCredential", () => {
  it("is null when everything is comfortably valid (no nudge, no noise)", () => {
    expect(worstCredential([cred("c1", "MMC", "2027-12-31")], NOW)).toBeNull();
    expect(worstCredential([], NOW)).toBeNull();
  });

  it("names an expiring-soon credential with its expiry", () => {
    const w = worstCredential([cred("c1", "MMC", "2026-08-12")], NOW);
    expect(w).toEqual({ type: "MMC", expiry: "2026-08-12", health: "expiring_soon" });
  });

  it("expired beats expiring-soon", () => {
    const w = worstCredential(
      [cred("c1", "MMC", "2026-08-12"), cred("c2", "TWIC", "2026-06-01")],
      NOW,
    );
    expect(w!.type).toBe("TWIC");
    expect(w!.health).toBe("expired");
  });

  it("within a band, the soonest expiry wins (most urgent renewal)", () => {
    const w = worstCredential(
      [cred("c1", "TWIC", "2026-08-20"), cred("c2", "MMC", "2026-07-15")],
      NOW,
    );
    expect(w!.type).toBe("MMC");
  });

  it("uses the 60-day window boundary healthOf uses", () => {
    // 2026-08-30 is exactly 60d from NOW → expiring_soon; 61d out → valid.
    expect(worstCredential([cred("c1", "MMC", "2026-08-30")], NOW)!.health).toBe(
      "expiring_soon",
    );
    expect(worstCredential([cred("c1", "MMC", "2026-08-31")], NOW)).toBeNull();
  });
});

/**
 * The boundary the roster flag and the oracle gate MUST share (audit C2.1-10).
 * They disagreed by one day: `healthOf` read the expiry as an instant at 00:00Z,
 * so any `now` past midnight on the expiry day said EXPIRED, while
 * `mmcValidOnDate` (`expiry >= tripDate`) still put the person in that day's pool.
 * A crew member could read "expired" on the roster and be legally askable for a
 * trip the same afternoon. These tests pin the two together from both sides.
 */
describe("healthOf ↔ mmcValidOnDate share one boundary", () => {
  const TODAY = "2026-07-01"; // NOW is midday on this date

  it("the expiry day itself is valid on BOTH sides, not expired on one", () => {
    expect(healthOf(cred("c1", "MMC", TODAY), NOW)).not.toBe("expired");
    expect(mmcValidOnDate([cred("c1", "MMC", TODAY)], TODAY).passed).toBe(true);
  });

  it("the day after expiry is expired on BOTH sides", () => {
    expect(healthOf(cred("c1", "MMC", "2026-06-30"), NOW)).toBe("expired");
    expect(mmcValidOnDate([cred("c1", "MMC", "2026-06-30")], TODAY).passed).toBe(false);
  });

  it("the verdict doesn't move with the time of day", () => {
    // Same date, three clock readings — an instant-based compare flipped between these.
    for (const t of ["00:00:00.000Z", "12:00:00.000Z", "23:59:59.000Z"]) {
      expect(healthOf(cred("c1", "MMC", TODAY), new Date(`${TODAY}T${t}`))).toBe(
        "expiring_soon",
      );
    }
  });
});
