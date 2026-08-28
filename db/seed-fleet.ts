/**
 * Production fleet seed — materializes the vessels + role types that the Xola
 * import resolves boats to (src/import/resource-map.ts → seedFleet).
 *
 * WITHOUT THIS, AN IMPORT FORMS SHIFTS WITH ZERO SEATS AND THE BOARD STAYS
 * EMPTY: the importer *looks vessels up* by Xola resource id, it does not create
 * them. This is the one-time bootstrap the deploy needs before the first import.
 *
 * Idempotent (every write is an upsert). Run once per environment:
 *   DATABASE_URL="<prod-neon-direct>" npm run db:seed:fleet
 *
 * Dev tooling, not app code. Uses the same Postgres adapter the app runs on.
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { seedFleet } from "../src/import/resource-map.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

try {
  const tenant = await seedFleet(repo);
  const vessels = await repo.listVessels();
  console.log(`Seeded fleet for ${tenant}: ${vessels.length} vessels + roles captain/mate.`);
  for (const v of vessels) {
    const manning = v.manning.map((m) => `${m.count}×${m.roleTypeId}`).join(", ") || "self-captained";
    console.log(`  - ${v.id}  (cap ${v.coiMaxPax}; ${manning})`);
  }
  console.log("\nNext: edit + run db/seed-pilot-crew.ts (npm run db:seed:crew:pilot), then import at /admin/import.");
  console.log("Fleet = the 4 BrewBoats (captain+mate) + the 2 X Shore hulls (captain only), capacities validated against live Xola Resources (DEC-043).");
} finally {
  await repo.close();
}
