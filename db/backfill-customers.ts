/**
 * `db:backfill:customers` — one-time backfill of `customers` from existing reservations
 * (12.12b, DEC-132).
 *
 * Groups every reservation by its CANONICAL phone and creates one customer per distinct phone,
 * then stamps `reservation.customer_id`. Reservations whose phone is absent or uncanonicalizable
 * stay unlinked, permanently and by design — they're history, and inventing an identity for them
 * would be worse than leaving them alone.
 *
 * **Reuses the service-layer canonicalizer** (`src/customers/identity.ts`) rather than doing it
 * in SQL. Two implementations of "what counts as the same phone" would drift, and the one in SQL
 * would be the one nobody tests.
 *
 * Idempotent: re-running finds the existing customer for each phone (get-or-create) and
 * re-stamps the same id. Safe to run twice; safe to run after new bookings have landed.
 *
 *   npx tsx db/backfill-customers.ts              # dry run — prints the plan, writes nothing
 *   BACKFILL_CONFIRM=yes npx tsx db/backfill-customers.ts
 *
 * Guarded like the other prod-capable scripts: dry-run by default, explicit confirm to write.
 */
import { existsSync } from "node:fs";
import pg from "pg";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { canonicalizePhone } from "../src/customers/identity.js";
import { customerIdForPhone, resolveCustomerId } from "../src/customers/resolve.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const confirm = process.env.BACKFILL_CONFIRM === "yes";

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: url });
  const repo = new PostgresRepository(pool);
  try {
    const reservations = await repo.listAllReservations();

    // Bucket by canonical phone. Newest `updatedAt` wins the display name — a later booking is
    // the better guess at how the person spells their own name today.
    const byPhone = new Map<string, { name: string; updatedAt: string; email?: string; count: number }>();
    let unlinkable = 0;
    for (const r of reservations) {
      const canonical = canonicalizePhone(r.phone);
      if (!canonical.ok) {
        unlinkable++;
        continue;
      }
      const stamp = r.updatedAt ?? "";
      const prior = byPhone.get(canonical.phone);
      if (!prior) {
        byPhone.set(canonical.phone, {
          name: r.customerName,
          updatedAt: stamp,
          ...(r.email !== undefined ? { email: r.email } : {}),
          count: 1,
        });
      } else {
        prior.count++;
        if (stamp > prior.updatedAt) {
          prior.name = r.customerName;
          prior.updatedAt = stamp;
        }
        if (prior.email === undefined && r.email !== undefined) prior.email = r.email;
      }
    }

    const linkable = reservations.length - unlinkable;
    console.log(`DB          ${url.replace(/:[^:@/]*@/, ":***@")}`);
    console.log(`reservations ${reservations.length}`);
    console.log(`  linkable   ${linkable} → ${byPhone.size} distinct customer(s)`);
    console.log(`  unlinkable ${unlinkable} (no phone, or not canonicalizable — stays NULL)`);

    if (!confirm) {
      console.log("\nDRY RUN — nothing written. Re-run with BACKFILL_CONFIRM=yes to apply.");
      for (const [phone, info] of [...byPhone].slice(0, 10)) {
        console.log(`  ${phone}  ${info.name}  (${info.count} booking${info.count === 1 ? "" : "s"})`);
      }
      if (byPhone.size > 10) console.log(`  … and ${byPhone.size - 10} more`);
      return;
    }

    let created = 0;
    let linked = 0;
    for (const r of reservations) {
      const canonical = canonicalizePhone(r.phone);
      if (!canonical.ok) continue;
      const info = byPhone.get(canonical.phone)!;

      const before = await repo.getCustomerByPhone(canonical.phone);
      const customerId = await resolveCustomerId(
        repo,
        {
          customerName: info.name,
          phone: canonical.phone,
          ...(info.email !== undefined ? { email: info.email } : {}),
        },
        // A backfilled customer is as old as the booking that revealed them, not as old as
        // this script run — otherwise every historical customer looks like it joined today.
        () => r.updatedAt ?? new Date().toISOString(),
      );
      if (!before) created++;
      if (customerId && r.customerId !== customerId) {
        await repo.saveReservation({ ...r, customerId });
        linked++;
      }
    }
    console.log(`\nDONE — created ${created} customer(s), linked ${linked} reservation(s).`);
    // Sanity: the id scheme is phone-derived, so a spot check needs no lookup table.
    const sample = [...byPhone.keys()][0];
    if (sample) console.log(`  e.g. ${sample} → ${customerIdForPhone(sample)}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
