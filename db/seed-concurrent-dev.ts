/**
 * `db:seed:concurrent` — put several LIVE offerings on ONE boat at ONE time, which is the state
 * issue #702 is about and which nothing else in the repo produces.
 *
 * A boat-time can be scheduled by more than one offering: three ways to sell the same hour, only
 * one of which can be sold. The admin calendar draws each as its own open card, and before #702
 * they landed at identical coordinates — text over text, three deep, with no way to tell there
 * was more than one.
 *
 * **Composes on `db:seed:reservation`; run it second:**
 *
 *   npm run db:seed:reservation
 *   npm run db:seed:concurrent
 *   npm run db:seed:concurrent -- --force   # bypass the local-DB guard
 *
 * It reuses that world's location and its derived date window rather than inventing its own, so
 * the extra offerings land inside the same season and on the same printed days. Re-running is an
 * upsert (ids are derived from the window, like the base seed's), and it writes no events and no
 * bookings — the slots it creates are *open*, which is the whole point.
 *
 * Both extras are scoped to **Brew 3 only**, deliberately: the other two hulls stay single-offering
 * so one screen shows the stacked case and the unaffected case side by side.
 *
 *   - "Twilight Tasting" — the SAME three departure times as the base offering, same 100-minute
 *     length. Exactly concurrent, so 13:30 on Brew 3 is three offerings deep.
 *   - "Harbor Hop" — a single 14:00 departure, 60 minutes. It starts inside the 13:30 trip rather
 *     than alongside it, which is the case a lane assignment keyed on equal start times would miss
 *     and a real interval overlap catches.
 */
import { existsSync } from "node:fs";
import type { Offering } from "../src/domain/entities.js";
import { asId } from "../src/domain/ids.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import {
  buildSeededReservationWorld,
  reservationDemo,
} from "../src/reservations/seed-reservation.js";
import { vesselDateOf } from "../src/config/tenant.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

// Local-DB guard, same as its siblings: this writes synthetic rows.
const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed writes synthetic rows — run it against a local/preview DB, or pass --force.`,
  );
  process.exit(1);
}

const repo = PostgresRepository.fromConnectionString(url);
try {
  const demo = reservationDemo(process.env.SEED_TODAY ?? vesselDateOf(new Date()));
  const world = buildSeededReservationWorld(new Date().toISOString(), demo);

  // The base world must already be there — this seed adds to it and cannot stand alone. Saying so
  // beats writing offerings that point at a location id nothing resolves.
  if (!(await repo.getLocation(world.location.id))) {
    console.error(
      "Refusing: run `npm run db:seed:reservation` first — this composes on that world " +
        `(location ${String(world.location.id)} is not in this database).`,
    );
    process.exit(1);
  }

  const BREW_3 = asId<"VesselId">("vessel-brew-3");
  const base = {
    tenantId: asId<"TenantId">("tenant-brewboat"),
    status: "live" as const,
    vesselIds: [BREW_3],
    locationId: world.location.id,
    priceVariations: [],
    includedGuestCount: 10,
    extraGuestPriceCents: 4000,
  };

  const offerings: Offering[] = [
    {
      ...base,
      id: asId<"OfferingId">(`offering-concurrent-a-${demo.window.start}`),
      name: "Twilight Tasting",
      schedule: {
        seasonStart: demo.season.start,
        seasonEnd: demo.season.end,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        departureTimes: [...demo.departureTimes],
      },
      tripLengthMinutes: 100,
      basePriceCents: 52900,
    },
    {
      ...base,
      id: asId<"OfferingId">(`offering-concurrent-b-${demo.window.start}`),
      name: "Harbor Hop",
      schedule: {
        seasonStart: demo.season.start,
        seasonEnd: demo.season.end,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        // Starts INSIDE the 13:30 departure rather than alongside it — the partial overlap.
        departureTimes: ["14:00"],
      },
      tripLengthMinutes: 60,
      basePriceCents: 29900,
    },
  ];

  for (const o of offerings) await repo.saveOffering(o);

  console.log(`✓ Seeded concurrent offerings on Brew 3 (db: ${new URL(url).host}).`);
  for (const o of offerings) {
    console.log(
      `  offering  ${String(o.id)}  ${o.name.padEnd(16)} ${o.schedule.departureTimes.join("/")}  ${o.tripLengthMinutes}min`,
    );
  }
  console.log(`  window    ${demo.window.start} … ${demo.window.end}`);
  console.log("");
  console.log("See it at /admin/calendar:");
  console.log(
    `  • ${demo.window.start} → Brew 3 at 13:30 is THREE offerings deep; 14:00 partially overlaps it.`,
  );
  console.log("  • Brew 1 and Brew 2 keep one offering each — the unaffected comparison.");
} finally {
  await repo.close();
}
