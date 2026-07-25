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
 * Also step 1 of the `db:all` registry (DEC-135) — hence the exported function
 * plus CLI-entry guard: `db:all` calls it in-process on one connection, while
 * `npm run db:seed:fleet` still runs it standalone against a live DB.
 *
 * Dev tooling, not app code. Uses the same Postgres adapter the app runs on.
 */
import { fileURLToPath } from "node:url";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { seedFleet } from "../src/import/resource-map.js";
import type { Repository } from "../src/ports/repository.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

export async function seedFleetDev(repo: Repository): Promise<void> {
  const tenant = await seedFleet(repo);
  const vessels = await repo.listVessels();
  console.log(`Seeded fleet for ${tenant}: ${vessels.length} vessels + roles captain/mate.`);
  for (const v of vessels) {
    const manning = v.manning.map((m) => `${m.count}×${m.roleTypeId}`).join(", ") || "self-captained";
    console.log(`  - ${v.id}  (cap ${v.coiMaxPax}; ${manning})`);
  }
  console.log("Fleet = the 4 real BrewBoats, capacities validated against live Xola Resources (DEC-043).");
}

// CLI entry: `npm run db:seed:fleet`. Skipped when imported by db:all.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const repo = PostgresRepository.fromConnectionString(url);
  try {
    await seedFleetDev(repo);
    // Roster bootstrap is CLI-only (DEC-134) — no crew PII in the repo. Only on
    // the standalone path: db:all seeds its own dev crew and shouldn't say this.
    console.log('\nNext: add crew with `npm run db:crew -- add --name="Jane Roe" --phone=+1… --email=… --ratings=captain,mate`');
    console.log("(seeds the DEC-044 placeholder MMC too), then import at /admin/import.");
  } finally {
    await repo.close();
  }
}
