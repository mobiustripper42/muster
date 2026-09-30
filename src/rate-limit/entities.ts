/**
 * Rate limiting — the stored shapes (Phase 18.3a, issue #1117, DEC-189).
 */

/**
 * One window in which a key was refused at least once — the refusal log (operator, 2026-09-30:
 * "to know if we are being targeted, or people are getting booted when they shouldn't"). One row
 * per bucket, key and window, never one per request, so a flood writes one row per attacking
 * address per window.
 */
export interface RateLimitRefusal {
  bucket: string;
  key: string;
  /** ISO-8601 UTC. */
  windowStart: string;
  /** Requests counted in the window, as of the latest refusal. */
  hits: number;
  /** Of those, how many were refused. */
  refused: number;
  /** ISO-8601 UTC. */
  firstRefusedAt: string;
  /** ISO-8601 UTC. */
  lastRefusedAt: string;
  /** ISO-8601 UTC — when the row may be swept (90 days on). */
  expiresAt: string;
}
