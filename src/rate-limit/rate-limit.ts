/**
 * The general rate limiter (Phase 18.3a, issue #1117, DEC-189) — a fixed-window counter in our
 * own Postgres, per client address.
 *
 * **Fixed window**, the most common rate-limiting algorithm: each window of `windowMs`, aligned to
 * the clock, counts its own hits, and the one past `limit` is refused until the window ends. Its
 * known weakness — up to twice the limit across a window boundary — does not matter at limits no
 * real crowd reaches, with another control behind each one.
 *
 * **Refusals are logged** (operator, 2026-09-30), one row per refused window, so "are we being
 * targeted?" and "are real people being turned away?" are answerable by SQL. The log never decides
 * anything: if writing it fails, the refusal still stands.
 *
 * **When the limiter itself breaks**, each policy says what happens (`failOpen`). Every policy so
 * far fails open: a guest at the gangway or a crew member signing in must never be locked out by a
 * broken counter, and each has a real control behind this one.
 */
import type { Repository } from "../ports/repository.js";
import { formatIp, parseIp, unwrapMappedV4 } from "./ip.js";

export interface RateLimitPolicy {
  /** Which limit this is — one per protected action, e.g. `crew-sign-in`. */
  bucket: string;
  /** Requests allowed per key per window. */
  limit: number;
  windowMs: number;
  /**
   * What happens when the counter cannot be read or written. Required, never defaulted: a future
   * consumer where the limiter is the ONLY control has to decide this on purpose.
   */
  failOpen: boolean;
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

export interface RateLimitDeps {
  repo: Repository;
  /** ISO-8601 UTC. */
  now: () => string;
  /** Told when the limiter itself fails; the request's fate is the policy's `failOpen`. */
  onFailure?: (message: string) => void;
}

/** How long a refused window stays in the log. */
export const REFUSAL_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Count this request against `key` and say whether it may proceed.
 *
 * A null key — no trustworthy client address — limits nothing and writes nothing. It is never
 * counted under a shared key: one bucket for everyone would let one abuser lock out every guest.
 */
export async function takeRateLimit(
  deps: RateLimitDeps,
  policy: RateLimitPolicy,
  key: string | null,
): Promise<RateLimitDecision> {
  if (key === null) return { allowed: true };

  const nowIso = deps.now();
  const nowMs = Date.parse(nowIso);
  const startMs = Math.floor(nowMs / policy.windowMs) * policy.windowMs;
  const endMs = startMs + policy.windowMs;
  const windowStart = new Date(startMs).toISOString();

  let hits: number;
  try {
    hits = await deps.repo.incrementRateLimit(policy.bucket, key, windowStart, new Date(endMs).toISOString(), nowIso);
  } catch (e) {
    deps.onFailure?.(
      `rate limit "${policy.bucket}" could not count — ${policy.failOpen ? "allowed" : "refused"}: ${message(e)}`,
    );
    return policy.failOpen ? { allowed: true } : { allowed: false, retryAfterMs: policy.windowMs };
  }
  if (hits <= policy.limit) return { allowed: true };

  try {
    await deps.repo.recordRateLimitRefusal(
      {
        bucket: policy.bucket,
        key,
        windowStart,
        hits,
        refused: hits - policy.limit,
        firstRefusedAt: nowIso,
        lastRefusedAt: nowIso,
        expiresAt: new Date(nowMs + REFUSAL_KEEP_MS).toISOString(),
      },
      nowIso,
    );
  } catch (e) {
    deps.onFailure?.(`rate limit "${policy.bucket}" refused, but the refusal was not logged: ${message(e)}`);
  }
  return { allowed: false, retryAfterMs: endMs - nowMs };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A client address as a limiter key, or null when it is not an address.
 *
 * IPv4 is kept whole; an IPv4 address written in IPv6 form is unwrapped to it first. **IPv6 is
 * keyed on its /64**: one home, office or phone network is handed a whole /64, so a single client
 * can walk the low 64 bits and look like billions of addresses.
 */
export function limitKeyFor(raw: string | null | undefined): string | null {
  const parsed = parseIp(raw);
  if (!parsed) return null;
  const ip = unwrapMappedV4(parsed);
  if (ip.version === 4) return formatIp(ip);
  const network = formatIp({ version: 6, value: (ip.value >> 64n) << 64n });
  return `${network.split(":").slice(0, 4).join(":")}::/64`;
}
