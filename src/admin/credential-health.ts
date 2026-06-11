/**
 * Credential-health derivation (SPEC §2.1 "credential-health flag").
 *
 * Pure: given a crew member's credential rows and a reference instant, classify
 * the worst-case standing as valid / expiring-soon / expired. The roster shows
 * this at the list level so Spink sees pool health without opening each person
 * (SPEC §2.1 "the pool-health view Spink currently keeps in his head").
 *
 * The expiring-soon window is policy, not mechanism. Strictly it belongs in
 * tenant config (DEC-001), but a tenant-config table is premature at M0 — so it
 * lives here as one named, overridable constant, trivially liftable later. The
 * reference instant (`now`) is always injected; the core never reads the clock,
 * which keeps this deterministic under test.
 */

import type { Credential } from "../domain/entities.js";

export type CredentialHealth = "valid" | "expiring_soon" | "expired";

/** Default expiring-soon window. Renew-before-you-drop horizon (SPEC §2.1). */
export const EXPIRING_SOON_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Health of a single credential at `now`. Expiry is an ISO-8601 date; a
 * credential is expired once `now` is past it, expiring-soon within the window,
 * else valid.
 */
export function healthOf(
  credential: Credential,
  now: Date,
  windowDays: number = EXPIRING_SOON_DAYS,
): CredentialHealth {
  // Expiry is a date-only ISO string → parsed at 00:00Z. A credential expiring
  // "today" thus reads expired once `now` passes midnight UTC — deliberately
  // conservative for a renew-before-you-drop flag. The oracle's date-valid gate
  // (§1.3) must adopt the same boundary so the two never disagree.
  const expiry = new Date(credential.expiry).getTime();
  const daysLeft = (expiry - now.getTime()) / MS_PER_DAY;
  if (daysLeft < 0) return "expired";
  if (daysLeft <= windowDays) return "expiring_soon";
  return "valid";
}

/**
 * Worst health across a crew member's credential rows — the flag shown on the
 * roster row. Worst wins: one expired credential flags the whole person expired.
 * No credentials → "valid" (nothing is lapsed); the oracle's gating is a
 * separate concern (§1.3).
 */
const HEALTH_RANK: Record<CredentialHealth, number> = {
  valid: 0,
  expiring_soon: 1,
  expired: 2,
};

export function credentialHealth(
  credentials: Credential[],
  now: Date,
  windowDays: number = EXPIRING_SOON_DAYS,
): CredentialHealth {
  return credentials.reduce<CredentialHealth>((worst, c) => {
    const h = healthOf(c, now, windowDays);
    return HEALTH_RANK[h] > HEALTH_RANK[worst] ? h : worst;
  }, "valid");
}

/** The band plus the credential behind it — what the crew nudge copy names. */
export interface CredentialConcern {
  type: Credential["type"];
  /** ISO-8601 expiry date of the offending credential. */
  expiry: string;
  health: Exclude<CredentialHealth, "valid">;
}

/**
 * The worst non-valid credential — the *which/when* behind the band, for the
 * crew app's nudge line (SPEC §2.6, #57: "MMC expires Aug 12 — renew it to keep
 * getting asked for shifts"). Null when everything is valid (no nudge). Worst
 * health wins; within a band the soonest expiry (the most urgent renewal).
 */
export function worstCredential(
  credentials: Credential[],
  now: Date,
  windowDays: number = EXPIRING_SOON_DAYS,
): CredentialConcern | null {
  let worst: CredentialConcern | null = null;
  for (const c of credentials) {
    const h = healthOf(c, now, windowDays);
    if (h === "valid") continue;
    if (
      worst === null ||
      HEALTH_RANK[h] > HEALTH_RANK[worst.health] ||
      (HEALTH_RANK[h] === HEALTH_RANK[worst.health] && c.expiry < worst.expiry)
    ) {
      worst = { type: c.type, expiry: c.expiry, health: h };
    }
  }
  return worst;
}
