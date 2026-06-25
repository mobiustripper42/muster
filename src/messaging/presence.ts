/**
 * The doorbell's presence classifier (#112, DEC-047/048). Pure — injected `now`,
 * no clock, no I/O. The `PresencePort` returns raw last-active timestamps; this
 * turns one into a verdict.
 *
 * Presence **suppresses** a ring (the subject is already looking), so the safe
 * default is **fail toward ringing**: an absent/unknown last-active reads as NOT
 * present, so the doorbell rings rather than silently swallowing a notification.
 *
 * The window is a parameter, not a constant here — its value is operator
 * tenant-config (DEC-046) and a tune-later researched default (the 6.3 spike,
 * DEC-TBD), so the core stays value-free.
 */
export function isPresent(
  lastActiveAt: string | null | undefined,
  now: string,
  windowMs: number,
): boolean {
  if (!lastActiveAt) return false; // never seen / unknown → fail toward ringing
  return Date.parse(now) - Date.parse(lastActiveAt) < windowMs;
}
