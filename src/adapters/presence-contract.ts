/**
 * The PresencePort contract (#112, DEC-047/058). One behavioral suite, run against
 * BOTH the in-memory double and the Postgres adapter — the parity guard that makes
 * "test on in-memory, run on Postgres" honest for presence, the same as the
 * Repository contract does for persistence.
 *
 * Not a test file itself (no `.test`): exports a registrar each adapter's test
 * file calls with a fresh-store factory.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Subject } from "../domain/entities.js";
import { subjectKey } from "../domain/subject.js";
import type { PresencePort } from "../ports/presence.js";

const CREW_A: Subject = { kind: "crew", id: "crew-a" };
const CREW_B: Subject = { kind: "crew", id: "crew-b" };
// The operator/office participates as crew-spink with the "admin" kind (DEC-058).
const OFFICE: Subject = { kind: "admin", id: "crew-spink" };

const T1 = "2026-07-01T12:00:00.000Z";
const T2 = "2026-07-01T12:05:00.000Z";

export function runPresenceContract(
  label: string,
  makeFreshPresence: () => Promise<PresencePort>,
): void {
  describe(`PresencePort contract — ${label}`, () => {
    let presence: PresencePort;
    beforeEach(async () => {
      presence = await makeFreshPresence();
    });

    it("records then reads last-active for a subject", async () => {
      await presence.recordActivity(CREW_A, T1);
      const map = await presence.lastActiveFor([CREW_A]);
      expect(map.get(subjectKey(CREW_A))).toBe(T1);
    });

    it("upsert is latest-wins (one row per subject)", async () => {
      await presence.recordActivity(CREW_A, T1);
      await presence.recordActivity(CREW_A, T2);
      const map = await presence.lastActiveFor([CREW_A]);
      expect(map.get(subjectKey(CREW_A))).toBe(T2);
      expect(map.size).toBe(1);
    });

    it("a never-seen subject is omitted from the map", async () => {
      await presence.recordActivity(CREW_A, T1);
      const map = await presence.lastActiveFor([CREW_A, CREW_B]);
      expect(map.has(subjectKey(CREW_A))).toBe(true);
      expect(map.has(subjectKey(CREW_B))).toBe(false); // absent → omitted, not null
      expect(map.size).toBe(1);
    });

    it("batch read returns only the queried present subjects, across kinds", async () => {
      await presence.recordActivity(CREW_A, T1);
      await presence.recordActivity(OFFICE, T2);
      await presence.recordActivity(CREW_B, T1); // present but not queried below
      const map = await presence.lastActiveFor([CREW_A, OFFICE]);
      expect(map.get(subjectKey(CREW_A))).toBe(T1);
      expect(map.get(subjectKey(OFFICE))).toBe(T2); // "admin" kind round-trips
      expect(map.has(subjectKey(CREW_B))).toBe(false); // not in the query
      expect(map.size).toBe(2);
    });

    it("empty query → empty map", async () => {
      await presence.recordActivity(CREW_A, T1);
      const map = await presence.lastActiveFor([]);
      expect(map.size).toBe(0);
    });

    it("the composite key distinguishes the same id across kinds (DEC-058)", async () => {
      // The whole reason the key is (kind, id): a crew id and an admin id can
      // collide as bare strings; the kind keeps them separate subjects.
      const crewShared: Subject = { kind: "crew", id: "shared" };
      const adminShared: Subject = { kind: "admin", id: "shared" };
      await presence.recordActivity(crewShared, T1);
      await presence.recordActivity(adminShared, T2);
      const map = await presence.lastActiveFor([crewShared, adminShared]);
      expect(map.get(subjectKey(crewShared))).toBe(T1);
      expect(map.get(subjectKey(adminShared))).toBe(T2);
      expect(map.size).toBe(2); // two distinct subjects, not one clobbered row
    });
  });
}
