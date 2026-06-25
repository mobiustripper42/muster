/**
 * Canonical `Subject` utilities (DEC-058).
 *
 * `subjectKey` is the string key the `PresencePort` returns its map under — the
 * in-memory rendering of a subject's composite identity. It is **never** the
 * stored shape: the DB keys presence on two columns `(subject_kind, subject_id)`
 * (DEC-058), so the delimiter here is a Map-key detail, not a schema contract. A
 * consumer reading `lastActiveFor(...)` rebuilds the same key for lookup.
 */
import type { Subject } from "./entities.js";

export function subjectKey(s: Subject): string {
  return `${s.kind}:${s.id}`;
}
