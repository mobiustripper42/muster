/**
 * Pilot crew seed — the REAL crew for the pilot weekend.
 *
 * Edit the CREW array below with your actual people, then run:
 *   DATABASE_URL="<prod-neon-direct>" npm run db:seed:crew:pilot
 *
 * Run db:seed:fleet FIRST — crew ratings reference the captain/mate roles it
 * creates. Idempotent (upserts on id) — re-run freely after edits.
 *
 *   ratings:   which seats they can fill — "captain" and/or "mate".
 *   mmcExpiry: MMC credential expiry, "YYYY-MM-DD". Omit if none on file
 *              (a captain with no valid MMC is ineligible for captain seats).
 *
 * Dev tooling, not app code. Uses the same Postgres adapter the app runs on.
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import type { RoleTypeId } from "../src/domain/ids.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const ratingId = (r: "captain" | "mate"): RoleTypeId => (r === "captain" ? CAPTAIN : MATE);

// ── EDIT THIS: your real pilot crew ──────────────────────────────────────────
const CREW: {
  id: string;
  name: string;
  phone: string;
  ratings: ("captain" | "mate")[];
  mmcExpiry?: string;
}[] = [
  { id: "crew-cap-1", name: "REPLACE — Captain 1", phone: "+15555550001", ratings: ["captain"], mmcExpiry: "2027-01-01" },
  { id: "crew-cap-2", name: "REPLACE — Captain 2", phone: "+15555550002", ratings: ["captain"], mmcExpiry: "2027-01-01" },
  { id: "crew-mate-1", name: "REPLACE — Mate 1", phone: "+15555550003", ratings: ["mate"] },
  { id: "crew-mate-2", name: "REPLACE — Mate 2", phone: "+15555550004", ratings: ["mate"] },
];
// ─────────────────────────────────────────────────────────────────────────────

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

try {
  for (const c of CREW) {
    await repo.saveCrewMember({
      id: asId<"CrewMemberId">(c.id),
      name: c.name,
      phone: c.phone,
      ratings: c.ratings.map(ratingId),
      status: "active",
      reliabilityScore: null,
    });
    if (c.mmcExpiry) {
      await repo.saveCredential({
        id: asId<"CredentialId">(`cred-${c.id}-mmc`),
        crewMemberId: asId<"CrewMemberId">(c.id),
        type: "MMC",
        expiry: c.mmcExpiry,
      });
    }
  }
  if (CREW.some((c) => c.name.startsWith("REPLACE"))) {
    console.warn("⚠ Crew still has REPLACE placeholders — edit db/seed-pilot-crew.ts with real names/phones/MMC dates.");
  }
  console.log(`Seeded ${CREW.length} pilot crew: ${CREW.map((c) => c.name).join(", ")}.`);
} finally {
  await repo.close();
}
