import { cookies } from "next/headers";
import {
  shouldRenew,
  signSession,
  verifySession,
  type Session,
} from "@core/auth/session.js";
import type { AuthSubject } from "@core/auth/magic-link.js";
import { getRepo } from "./repo";

/**
 * Session-cookie glue (DEC-010, DEC-020). The crypto lives in the framework-free
 * core (`@core/auth/session`); this is the thin Next layer that reads/writes the
 * httpOnly cookie. A magic-link verify mints the cookie; every request that finds
 * a still-valid one inside the renewal window silently re-issues it (sliding
 * expiry), so active crew never get bounced back to a new link.
 */
const COOKIE = "muster_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const RENEW_WITHIN_MS = 3 * 24 * 60 * 60 * 1000; // re-issue inside the last 3 days

// Prod MUST set SESSION_SECRET — an unset secret in production would degrade to a
// repo-public signing key, letting anyone forge a session for any subject. Fail
// fast there (mirrors the dev-link route's prod hard-stop). Dev uses an obvious
// insecure default for zero-config local work. Resolved LAZILY (per request, not
// at module load) so `next build` — which evaluates modules in production mode
// without the env set — doesn't trip the guard.
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return "dev-insecure-session-secret";
}

function makeSession(subject: AuthSubject, now: Date): Session {
  return {
    subjectKind: subject.kind,
    subjectId: subject.id,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };
}

const cookieOptions = (expiresAt: string) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  expires: new Date(expiresAt),
});

/**
 * The session cookie as name/value/options — so a caller that owns its own
 * response (a redirect from the magic-link landing) can set it directly, dodging
 * the next/headers-cookies-plus-redirect footgun.
 */
export function buildSessionCookie(subject: AuthSubject, now = new Date()) {
  const session = makeSession(subject, now);
  return {
    name: COOKIE,
    value: signSession(session, secret()),
    options: cookieOptions(session.expiresAt),
  };
}

/** Mint + set the session cookie (server-action / mutable-context use). */
export async function startSession(subject: AuthSubject): Promise<void> {
  const { name, value, options } = buildSessionCookie(subject);
  const jar = await cookies();
  jar.set(name, value, options);
}

/**
 * Read the current subject, or null if absent/invalid/expired. Renews the cookie
 * in place when it's inside the renewal window (best-effort — a read in a context
 * that can't set cookies just skips the renewal).
 */
export async function readSubject(): Promise<AuthSubject | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const now = new Date();
  const result = verifySession(token, secret(), now);
  if (!result.ok) return null;

  // Per-person revoke (DEC-092): an admin's session is only good while their row
  // exists and `active`. This is the ONE stateful check — deprovisioning flips the
  // flag and the next request dies here. Scoped to admin subjects (~3, cold
  // cockpit); crew subjects skip the lookup, so the magic-link hot path stays
  // fully stateless. A revoked admin is treated exactly like no session.
  if (result.subject.kind === "admin") {
    const admin = await getRepo().getAdmin(result.subject.id);
    if (!admin || !admin.active) return null;
  }

  if (shouldRenew(result.session, now, RENEW_WITHIN_MS)) {
    const renewed = makeSession(result.subject, now);
    try {
      jar.set(COOKIE, signSession(renewed, secret()), cookieOptions(renewed.expiresAt));
      // NOT a fault (#854). Next throws from `cookies().set()` in any read-only
      // context, which is every Server Component render — so this fires on ordinary
      // traffic, by design, and the renewal simply happens on the next write.
      //
      // NARROW CAVEAT, deliberately left alone: `signSession(renewed, secret())` is
      // evaluated as an argument, so it sits INSIDE this try. A missing or malformed
      // SESSION_SECRET would therefore be swallowed as "read-only context" and silently
      // stop renewals. Hoisting the sign above the try would separate the two, but it
      // changes what escapes `readSubject()` on every request — out of scope here.
      // eslint-disable-next-line no-restricted-syntax -- read-only render context, by design
    } catch {
      // Read-only context (e.g. a Server Component render) — renew next write.
    }
  }
  return result.subject;
}

/** Drop the session (sign-out). */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
