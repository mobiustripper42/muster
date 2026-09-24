/**
 * Bearer-secret primitives — mint one, and hash it for storage.
 *
 * The calendar feed token (DEC-098) is the one bearer left that these serve. They lived in
 * `magic-link.ts` until issue #1030 retired the magic link; the file went, these two did not.
 *
 * Only `hashSecret(secret)` is ever stored; the raw secret is shown once and forgotten.
 */

import { createHash, randomBytes } from "node:crypto";

/** sha256(secret) as hex — the only form of the secret that's ever stored. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Production secret generator: 32 crypto-random bytes, URL-safe. The one place
 * the core legitimately needs randomness — it's a secret, not an id (ids stay
 * deterministic, DEC-008).
 */
export function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}
