/**
 * The presence port (#112, DEC-047 / DEC-048).
 *
 * The doorbell's "is this subject looking right now" input, behind a swap-later
 * seam. v1 is a **coarse activity signal**: natural app activity (loading a
 * thread, sending) plus an occasional lightweight check, recorded as a last-active
 * timestamp. NO managed-realtime vendor and NO socket server (DEC-047) — the
 * batch window absorbs the signal's staleness and "fail toward ringing" handles
 * the edges. A hosted/self-hosted realtime service is a **later additive adapter**
 * behind this same port, adopted only if instant chat is wanted, with **zero
 * change to the doorbell decider**.
 *
 * Read-only for the decider; the only write is `recordActivity`, called at the
 * edge on observed activity. Presence is **observed-only, never crew-curated**
 * (DEC-046) — there is no crew "set my availability / quiet hours" surface.
 *
 * Capture/decision split (DEC-048): this port returns raw timestamps (I/O); the
 * pure `isPresent` classifier (`src/messaging/presence.ts`) turns a timestamp +
 * injected `now` + window into a verdict.
 */
import type { Subject } from "../domain/entities.js";

export interface PresencePort {
  /**
   * Record that `subject` was active at ISO-8601 `at`. Upsert, latest-wins — one
   * row per subject. Called by the edge on natural activity + the occasional
   * lightweight check (call-sites land in 6.6/6.7); never by a crew settings
   * surface (DEC-046).
   */
  recordActivity(subject: Subject, at: string): Promise<void>;
  /**
   * Last-active ISO timestamp for each queried subject, for the decider to
   * classify against `now` + window. Keyed by `subjectKey` (`${kind}:${id}` —
   * the composite identity rendered as a Map key, DEC-058). A subject never seen
   * is **omitted** from the map (read by the decider as not-present → fail toward
   * ringing). Empty query → empty map.
   */
  lastActiveFor(subjects: Subject[]): Promise<Map<string, string>>;
}
