/**
 * In-memory PresencePort double (#112). The test substrate + the contract's
 * fast adapter; it must pass the same suite as the Postgres adapter, so the
 * presence-dependent domain tests that lean on it stay trustworthy.
 *
 * One map: subjectKey → last-active ISO. Strings are immutable, so no clone.
 */
import type { Subject } from "../domain/entities.js";
import { subjectKey } from "../domain/subject.js";
import type { PresencePort } from "../ports/presence.js";

export class InMemoryPresence implements PresencePort {
  readonly #lastActive = new Map<string, string>();

  async recordActivity(subject: Subject, at: string): Promise<void> {
    this.#lastActive.set(subjectKey(subject), at); // latest-wins upsert
  }

  async lastActiveFor(subjects: Subject[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const s of subjects) {
      const key = subjectKey(s);
      const at = this.#lastActive.get(key);
      if (at !== undefined) out.set(key, at); // absent → omitted
    }
    return out;
  }
}
