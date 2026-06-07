/**
 * Self-rolled session tokens (DEC-010, DEC-020) — the layer above the magic link.
 *
 * A magic link is single-use and minutes-short (magic-link.ts). What it BUYS is a
 * session: a longer-lived, renewable credential the client stores so crew don't
 * re-auth every visit. This module mints and verifies that credential.
 *
 * Stateless by design: the token is `base64url(payload).base64url(HMAC-SHA256)`,
 * so verification needs only the secret — no session table, no DB round-trip on
 * every request. Tamper-evident (a flipped byte fails the HMAC) and self-expiring
 * (the payload carries `expiresAt`). Renewal is re-issue: when a still-valid token
 * is inside the renewal window, the caller mints a fresh one (sliding expiry).
 *
 * Framework-free: pure `node:crypto`, injected `now`. The Next glue that reads and
 * writes the cookie lives in the app (app/lib/session.ts), not here.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthSubjectKind } from "../domain/entities.js";
import type { AuthSubject } from "./magic-link.js";

export interface Session {
  subjectKind: AuthSubjectKind;
  subjectId: string;
  /** ISO-8601 UTC. Past this instant the token is dead. */
  expiresAt: string;
}

const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
const unb64url = (s: string): string => Buffer.from(s, "base64url").toString("utf8");

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/** Mint a signed session token. `expiresAt` is the caller's chosen lifetime. */
export function signSession(session: Session, secret: string): string {
  const payloadB64 = b64url(JSON.stringify(session));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export type SessionFailure = "malformed" | "bad_signature" | "expired";

export type SessionResult =
  | { ok: true; session: Session; subject: AuthSubject }
  | { ok: false; reason: SessionFailure };

/**
 * Verify a token: well-formed → signature valid (constant-time) → not expired.
 * Returns the session and a convenience `subject` ({kind,id}) on success.
 */
export function verifySession(
  token: string,
  secret: string,
  now: Date,
): SessionResult {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payloadB64, secret);
  // Constant-time compare; mismatched lengths can't be timing-safe, so guard first.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let session: Session;
  try {
    session = JSON.parse(unb64url(payloadB64)) as Session;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof session?.subjectId !== "string" ||
    typeof session?.expiresAt !== "string" ||
    (session.subjectKind !== "admin" && session.subjectKind !== "crew")
  ) {
    return { ok: false, reason: "malformed" };
  }
  const exp = Date.parse(session.expiresAt);
  // A non-parseable expiry can't be trusted to be in the future — treat a NaN as
  // dead (defense-in-depth; a tampered payload already fails the HMAC above).
  if (Number.isNaN(exp) || now.getTime() >= exp) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    session,
    subject: { kind: session.subjectKind, id: session.subjectId },
  };
}

/**
 * Sliding-expiry helper: is a valid token close enough to expiry that the caller
 * should re-issue a fresh one this request? Keeps an active crew member logged in
 * without ever forcing a new magic link.
 */
export function shouldRenew(
  session: Session,
  now: Date,
  renewWithinMs: number,
): boolean {
  return Date.parse(session.expiresAt) - now.getTime() <= renewWithinMs;
}
