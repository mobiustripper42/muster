/**
 * `db:seed:pay-link` — the payment link's three payable states (issue #1251), so `/p/<token>` has an
 * unpaid phone booking to open without taking a call first. Three UNPAID operator bookings on the
 * demo offering (`source: admin`, `pending`), each printed with its link:
 *
 *   - **Ines Varga, outside the balance window** — a quote above the deposit. The page offers
 *     `Pay deposit · $100.00` (preselected) and `Pay in full`.
 *   - **Joss Hartwell, inside the balance window** — the whole quote, no choice.
 *   - **Kit Almeida, a quote at or below the deposit** — the whole quote, no choice, even outside
 *     the window.
 *
 * The bookings go through the real path, `bookForCustomer`, so each is written due in full with the
 * invoice the operator would have frozen; only paying the link sets a split (issue #1251).
 *
 * **Composes after `npm run db:seed:reservation`**, which writes the live demo offering these book:
 *
 *   npm run db:seed:reservation && npm run db:seed:pay-link
 *   npm run db:seed:pay-link -- --force   # bypass the local-DB guard
 *
 * The outside-window departure falls past the demo season's end, so the season is run through it.
 * Re-running is safe: a slot already held is not booked again, and its link is printed afresh.
 */
import { existsSync } from "node:fs";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { stripTrailingSlashes } from "../src/config/base-url.js";
import { addDays, vesselDateOf } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import type { Reservation } from "../src/domain/entities.js";
import { formatCents } from "../src/reservations/calendar-detail.js";
import { bookForCustomer } from "../src/reservations/operator-booking.js";
import { paymentLinkUrl, signPaymentLink } from "../src/reservations/payment-link.js";
import { reservationDemo } from "../src/reservations/seed-reservation.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

if (existsSync(".env.local")) {
  const inlineDb = process.env.DATABASE_URL;
  process.loadEnvFile(".env.local");
  if (inlineDb) process.env.DATABASE_URL = inlineDb;
}

const args = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

// Local-DB guard (mirrors db:seed:reservation): this writes synthetic rows.
const isLocal = /(?:@|\/\/)(?:localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal && !args.includes("--force")) {
  console.error(
    `Refusing: DATABASE_URL doesn't look local (${url.replace(/:[^:@/]*@/, ":***@")}).\n` +
      `This seed writes synthetic rows — run it against a local/preview DB, or pass --force.`,
  );
  process.exit(1);
}

const today = vesselDateOf(new Date());
const demo = reservationDemo(today);
const now = () => new Date().toISOString();
const repo = PostgresRepository.fromConnectionString(url);

// The app's dev defaults (`env.example`): the signing secret the running app verifies a link with,
// and the origin it is served on.
const secret = process.env.SESSION_SECRET || "dev-insecure-session-secret";
const base = stripTrailingSlashes(process.env.APP_BASE_URL || "http://localhost:3000");

/** The latest of two ISO days. */
const later = (a: string, b: string) => (a > b ? a : b);

/** The operator books it on the phone: unpaid, no insurance, due in full. */
async function phoneBook(
  date: string,
  time: string,
  customerName: string,
  phone: string,
  extra: { guestCount: number; discountCents?: number },
): Promise<Reservation | null> {
  const res = await bookForCustomer(
    repo,
    {
      offeringId: asId<"OfferingId">(demo.offeringId),
      vesselId: asId<"VesselId">(demo.vesselId),
      date,
      time,
      gratuityBps: 2000,
      customerName,
      phone,
      hasFlex: false,
      ...extra,
    },
    now,
  );
  if (res.ok) return res.reservation;
  // Already seeded: the slot is held by that booking, so print its link rather than book it twice.
  const held = (await repo.listAllReservations()).find(
    (r) => r.customerName === customerName && r.date === date && r.time === time && r.status === "pending",
  );
  if (held) return held;
  console.log(`  skipped   ${date} ${time}  ${customerName} — ${res.reason}`);
  return null;
}

function show(row: Reservation, note: string): void {
  const link = paymentLinkUrl(base, signPaymentLink(String(row.id), new Date(), secret));
  console.log(`  unpaid    ${row.date} ${row.time}  ${row.customerName}  ${formatCents(row.invoice!.totalCents)}`);
  console.log(`            ${link}   ${note}`);
}

try {
  const offeringId = asId<"OfferingId">(demo.offeringId);
  const offering = await repo.getOffering(offeringId);
  if (!offering) {
    console.error("No demo offering — run `npm run db:seed:reservation` first.");
    process.exit(1);
  }

  console.log(`✓ Payment link (db: ${new URL(url).host}).`);

  // ── Outside the balance window, past the demo season: run the season through it ──
  const outsideDate = later(addDays(today, 40), addDays(demo.window.end, 1));
  if (offering.schedule.seasonEnd < outsideDate) {
    await repo.saveOffering({ ...offering, schedule: { ...offering.schedule, seasonEnd: outsideDate } });
  }

  const ines = await phoneBook(outsideDate, "13:30", "Ines Varga", "216-555-1251", { guestCount: 6 });
  if (ines) show(ines, `the choice: Pay deposit · $100.00 (preselected) and Pay in full`);

  // ── Inside the window: 20 days out, the whole quote ──────────────────────────
  const joss = await phoneBook(addDays(today, 20), "13:30", "Joss Hartwell", "440-555-1251", { guestCount: 6 });
  if (joss) show(joss, `inside the balance window: the whole quote, no choice`);

  // ── A quote at or below the deposit: one guest, the fare discounted to $50 ────
  const kit = await phoneBook(outsideDate, "15:30", "Kit Almeida", "330-555-1251", {
    guestCount: 1,
    discountCents: Math.max(0, offering.basePriceCents - 5000),
  });
  if (kit) {
    show(kit, `a quote at or below the deposit: the whole quote, no choice`);
    if (kit.invoice!.totalCents > 10000) {
      console.error(`  ALERT     Kit Almeida's quote is above the $100 deposit — the demo's pricing has moved; adjust the discount`);
    }
  }
} finally {
  await repo.close();
}
