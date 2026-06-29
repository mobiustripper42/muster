/**
 * Crew self-serve login codes (DEC-080) — the service layer, no platform.
 *
 * The crew front door (DEC-079): a crew member opens the app on their own
 * initiative, enters their email, gets a 6-digit code in that email, and pastes
 * it back. Two operations, mirroring the magic-link core but for a SHORT secret:
 *   request → match an email to a roster crew member, mint a 6-digit code, store
 *             only its hash (one live code per subject — re-request upserts).
 *   verify  → re-hash a presented code, find the subject's live code, check it's
 *             live and under the attempt cap, and CONSUME it atomically (CAS) so
 *             a code can't be redeemed twice.
 *
 * Why a code and not a magic link (DEC-080): the link opens in the email app's
 * browser, not the installed PWA, so the session lands in the wrong context — the
 * #1 magic-link failure on mobile. A code never leaves the app you started in.
 *
 * Why its own primitive and not `magic_tokens`: a 6-digit code is NOT globally
 * unique (collisions across crew are likely) and `magic_tokens.token_hash` is
 * `unique` + hash-keyed — so codes are keyed by SUBJECT instead, which is also
 * what makes `attempts` capping possible (you must find the row by who, not by a
 * wrong guess that hashes to nothing).
 *
 * Security rests on the CAP, not the entropy: 6 digits + a 5-attempt ceiling +
 * a 10-minute TTL is a ~1-in-200k shot per code — the throttle does the work, so
 * the code can stay short and number-pad-friendly.
 *
 * Clockless/deterministic like the rest of the core: `now` and `mintCode` are
 * injected (tests stay deterministic; production passes a crypto-random
 * generator — see the helper at the bottom). Hashing is sha256 (pure), so only
 * the hash ever touches storage.
 */

import { createHash, randomInt } from "node:crypto";
import type { CrewMember, LoginCode, Subject } from "../domain/entities.js";
import { assertIsoDateTime } from "../domain/iso-date.js";
import type { Repository } from "../ports/repository.js";

/** How long a code stays redeemable. Short by design. */
export const CODE_TTL_MS = 10 * 60_000;
/**
 * Failed guesses before the code is dead — the brute-force ceiling PER CODE.
 * NOT a per-target bound: a re-mint after the cooldown writes a fresh row with
 * `attempts: 0`, so the sustained rate is MAX_ATTEMPTS per RESEND_COOLDOWN_MS,
 * indefinitely. That's the accepted DEC-080 "throttle does the work" posture at
 * pilot scale; a daily re-mint cap / escalating lockout is a 7.0b hardening
 * follow-up (issue #189), not a hard guarantee this constant gives today.
 */
export const MAX_ATTEMPTS = 5;
/** Suppress a fresh re-mint within this window — anti-spam + dedup. */
export const RESEND_COOLDOWN_MS = 60_000;

/** sha256(code) as hex — the only form of the code that's ever stored. */
export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Production code generator: a uniform 6-digit string, zero-padded. */
export function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Trim + lowercase — the canonical form both sides compare on. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Resolve an entered email to a single roster crew member, or null. Pilot-scale
 * in-memory match (no by-email index — DEC-080); deterministic on id when an
 * email is somehow shared, so the same email always binds to the same subject.
 */
function matchCrewByEmail(
  crew: readonly CrewMember[],
  email: string,
): CrewMember | null {
  const norm = normalizeEmail(email);
  const hits = crew
    .filter((c) => c.email && normalizeEmail(c.email) === norm)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hits[0] ?? null;
}

export interface RequestParams {
  email: string;
}

export interface RequestDeps {
  now: Date;
  /** Returns a fresh 6-digit code. Inject crypto-random in production. */
  mintCode: () => string;
}

/**
 * What the caller should do — never leaks whether the email matched (the
 * surface shows the SAME generic response either way; only `deliver` actually
 * sends, which the requester can't observe — that's the no-enumeration guard).
 */
export type RequestResult =
  | {
      outcome: "deliver";
      subject: Subject;
      recipientEmail: string;
      recipientName: string;
      code: string;
    }
  | { outcome: "skip" };

/**
 * Mint a login code for a matching email and tell the caller to deliver it.
 *
 * No-enumeration: the RESPONSE is identical on match and miss (the caller shows
 * the same screen either way). The CPU hash work runs on both paths too. But the
 * symmetry is not perfect — a match also does a SELECT + UPSERT and asks the
 * caller to deliver, a miss returns before either. In 7.0a (fake delivery, local
 * DB) that delta is ~2 round-trips, small. The sharp version is 7.0b: if the
 * caller `await`s a real email send (only on a match), a match becomes
 * observably slower — a timing oracle. The fix lives at the delivery seam (don't
 * await the network on the hot path; see auth-delivery.ts), not here.
 *
 * A live code younger than the cooldown suppresses a re-mint (anti-spam) but
 * still returns `skip`, indistinguishable from a non-match.
 */
export async function requestLoginCode(
  repo: Repository,
  params: RequestParams,
  deps: RequestDeps,
): Promise<RequestResult> {
  const crew = matchCrewByEmail(await repo.listCrewMembers(), params.email);

  // Run the mint+hash regardless — equal CPU work on match and non-match.
  const code = deps.mintCode();
  const codeHash = hashCode(code);

  if (!crew || !crew.email) return { outcome: "skip" };

  // Anti-spam: a still-live code minted within the cooldown is left in place —
  // the crew member already has one in their inbox. Indistinguishable from a miss.
  const existing = await repo.getLoginCode("crew", crew.id);
  if (
    existing &&
    !existing.consumedAt &&
    deps.now.getTime() < Date.parse(existing.expiresAt) &&
    deps.now.getTime() - Date.parse(existing.createdAt) < RESEND_COOLDOWN_MS
  ) {
    return { outcome: "skip" };
  }

  const createdAt = deps.now.toISOString();
  const expiresAt = new Date(deps.now.getTime() + CODE_TTL_MS).toISOString();
  // The door (DEC-DATA-1): self-minted stamps pass the validator too.
  assertIsoDateTime(createdAt, "loginCode.createdAt");
  assertIsoDateTime(expiresAt, "loginCode.expiresAt");

  const record: LoginCode = {
    subjectKind: "crew",
    subjectId: crew.id,
    codeHash,
    createdAt,
    expiresAt,
    attempts: 0,
  };
  await repo.saveLoginCode(record);

  return {
    outcome: "deliver",
    subject: { kind: "crew", id: crew.id },
    recipientEmail: crew.email,
    recipientName: crew.name,
    code,
  };
}

export type VerifyFailure = "invalid" | "expired" | "locked";

export type VerifyResult =
  | { ok: true; subject: Subject }
  | { ok: false; reason: VerifyFailure };

export interface VerifyParams {
  email: string;
  code: string;
}

export interface VerifyDeps {
  now: Date;
}

/**
 * Redeem a presented code. Subject-scoped (we find the code by WHO, then compare
 * the hash) so a wrong guess that hashes to nothing can still be counted against
 * the attempt cap. A correct code consumes via the port CAS — single-use even
 * under two simultaneous submits. `invalid` is deliberately vague (wrong code,
 * no code, or non-matching email all look the same) so nothing leaks.
 */
export async function verifyLoginCode(
  repo: Repository,
  params: VerifyParams,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const crew = matchCrewByEmail(await repo.listCrewMembers(), params.email);
  if (!crew) return { ok: false, reason: "invalid" };

  const record = await repo.getLoginCode("crew", crew.id);
  if (!record || record.consumedAt) return { ok: false, reason: "invalid" };
  if (deps.now.getTime() >= Date.parse(record.expiresAt)) {
    return { ok: false, reason: "expired" };
  }
  if (record.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  if (hashCode(params.code) !== record.codeHash) {
    const attempts = await repo.bumpLoginCodeAttempts("crew", crew.id);
    return {
      ok: false,
      reason: attempts >= MAX_ATTEMPTS ? "locked" : "invalid",
    };
  }

  const won = await repo.consumeLoginCodeIfUnused(
    "crew",
    crew.id,
    deps.now.toISOString(),
  );
  // Lost the race (a concurrent submit consumed it first) → treat as invalid.
  if (!won) return { ok: false, reason: "invalid" };

  return { ok: true, subject: { kind: "crew", id: crew.id } };
}
