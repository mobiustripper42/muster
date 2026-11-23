/**
 * A whole-number `app_settings` value (issue #1250) — the one parse the booking cutoff's hours and
 * the deposit's cents share.
 *
 * Absent ⇒ the fallback, silently. A whole number (surrounding spaces allowed) ⇒ that number.
 * Anything else — negative, a fraction, a unit, empty — ⇒ the fallback **and a log line**: a typo in
 * a hand-written SQL row must not break the site, and must not be silent either, because the
 * operator believes the setting is in force.
 */
import { logSwallowed } from "../log.js";

/**
 * @param raw The stored string, or null/undefined when the key has no row.
 * @param key The `app_settings` key, named in the log line.
 * @param fallback What a missing or malformed value reads as.
 * @param consequence What is now untrue because of the fallback — the log line's second half.
 */
export function parseWholeNumberSetting(
  raw: string | null | undefined,
  key: string,
  fallback: number,
  consequence: string,
): number {
  if (raw === null || raw === undefined) return fallback;
  if (/^\s*\d+\s*$/.test(raw)) return Number(raw.trim());
  logSwallowed(
    `settings:${key}`,
    new Error(`${key} is ${JSON.stringify(raw)}, not a whole number`),
    consequence,
  );
  return fallback;
}
