/**
 * Self-rolled magic-link auth (DEC-010, DEC-020) — the service layer, no platform.
 *
 * Two operations, same mechanism for admin (Spink) and crew:
 *   issue  → mint a single-use secret, store only its hash, return the secret so
 *            the caller can build a link and hand it to the channel port.
 *   verify → re-hash a presented secret, find the row, check it's live, and
 *            CONSUME it atomically (a port compare-and-swap) so a replayed link
 *            can't be redeemed twice — even under two concurrent taps.
 *
 * Scope boundary (PR 3): this is the LINK, not the SESSION. A successful verify
 * returns the subject; turning that into a longer-lived, renewable session the
 * PWA/native client stores is the surface layer's job (1.5b). Keeping issue→verify
 * the seam means the session machinery builds on top without reopening auth.
 *
 * Clockless/deterministic like the rest of the core: `now` is injected, and the
 * unguessable secret comes from an injected `mintSecret` so tests stay
 * deterministic (production passes a crypto-random generator — see the helper at
 * the bottom). Hashing is sha256 (pure), so only the hash ever touches storage.
 */

import { createHash, randomBytes } from "node:crypto";
import type { AuthSubjectKind, MagicToken } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { assertIsoDateTime } from "../domain/iso-date.js";
import type { Repository } from "../ports/repository.js";

/** sha256(secret) as hex — the only form of the secret that's ever stored. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Production secret generator: 32 crypto-random bytes, URL-safe. The one place
 * the core legitimately needs randomness — it's a secret, not an id (ids stay
 * deterministic, DEC-008). Inject this as `mintSecret` outside tests.
 */
export function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Who a verified link authenticates. `id` is interpreted per `kind` (DEC-010). */
export interface AuthSubject {
  kind: AuthSubjectKind;
  id: string;
}

export interface IssueParams {
  subjectKind: AuthSubjectKind;
  subjectId: string;
  /** How long the link stays redeemable, in ms. Short by design (minutes). */
  ttlMs: number;
}

export interface IssueDeps {
  now: Date;
  /** Returns a fresh, unguessable secret. Inject crypto-random in production. */
  mintSecret: () => string;
}

/** The persisted token plus the raw secret — the secret goes in the link, once. */
export interface IssuedLink {
  token: MagicToken;
  secret: string;
}

/**
 * Mint and persist a magic-link token. Returns the raw `secret` (caller builds
 * the URL, e.g. `https://app/auth?t=<secret>`, and sends it via the channel
 * port). Only `hashSecret(secret)` is stored.
 */
export async function issueMagicLink(
  repo: Repository,
  params: IssueParams,
  deps: IssueDeps,
): Promise<IssuedLink> {
  const secret = deps.mintSecret();
  const tokenHash = hashSecret(secret);
  const createdAt = deps.now.toISOString();
  const expiresAt = new Date(deps.now.getTime() + params.ttlMs).toISOString();
  // The door (DEC-DATA-1): even self-minted stamps pass the validator, so the
  // discipline is uniform and a future bad `now` can't slip text rot into storage.
  assertIsoDateTime(createdAt, "magicToken.createdAt");
  assertIsoDateTime(expiresAt, "magicToken.expiresAt");

  const token: MagicToken = {
    id: asId<"MagicTokenId">(`mtk-${tokenHash}`),
    tokenHash,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
    createdAt,
    expiresAt,
  };
  await repo.saveMagicToken(token);
  return { token, secret };
}

export type VerifyFailure = "not_found" | "expired" | "consumed";

export type VerifyResult =
  | { ok: true; subject: AuthSubject }
  | { ok: false; reason: VerifyFailure };

export interface VerifyDeps {
  now: Date;
}

/**
 * Redeem a presented secret. Single-use and time-bounded; the actual consume is
 * a port CAS so two simultaneous taps can't both win. The pre-CAS reads exist to
 * return a precise reason; the CAS is the source of truth for "did I consume it".
 */
export async function verifyMagicLink(
  repo: Repository,
  secret: string,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const tokenHash = hashSecret(secret);
  const token = await repo.getMagicTokenByHash(tokenHash);
  if (!token) return { ok: false, reason: "not_found" };
  if (token.consumedAt) return { ok: false, reason: "consumed" };
  if (deps.now.getTime() >= Date.parse(token.expiresAt)) {
    return { ok: false, reason: "expired" };
  }

  const won = await repo.consumeMagicTokenIfUnused(
    tokenHash,
    deps.now.toISOString(),
  );
  // Lost the race (a concurrent tap consumed it first) → treat as consumed.
  if (!won) return { ok: false, reason: "consumed" };

  return {
    ok: true,
    subject: { kind: token.subjectKind, id: token.subjectId },
  };
}
