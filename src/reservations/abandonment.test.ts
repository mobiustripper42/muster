/**
 * The abandonment view (14.8, SPEC §2.8.8) — PURE, no repo, no clock of its own.
 *
 * The screen exists because nothing deletes a lapsed row. §2.8.8 builds the monitor before the
 * destructive tool, so these rows accumulate and this is what reads them. It answers "how many
 * checkouts were started and walked away from" by being looked at.
 *
 * **Raw and unranked on purpose.** No field on a row separates scripted abuse from real
 * abandonment — an absent payment id means "never reached the provider", which is a script *or* a
 * provider outage *or* a dropped connection. These tests pin what the screen *shows*, and
 * deliberately pin no verdict, because inventing one would be inventing a fact the data hasn't got.
 */
import { describe, expect, it } from "vitest";
import type { Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { abandonedCheckouts, summarizeAbandonment } from "./abandonment.js";

const V = asId<"VesselId">("v-small");
const OFF = asId<"OfferingId">("off-1");
// The window is 15 minutes, so a row reserved before 11:45 has lapsed at NOW.
const NOW = "2026-07-04T12:00:00.000Z";
const LAPSED = "2026-07-04T11:30:00.000Z"; // 30 min before NOW
const LIVE = "2026-07-04T11:55:00.000Z"; //  5 min before NOW

const row = (over: Partial<Reservation> = {}): Reservation => ({
  id: asId<"ReservationId">("r-1"),
  eventId: null,
  source: "muster",
  status: "pending",
  customerName: "Brody",
  partySize: 4,
  vesselId: V,
  date: "2026-07-04",
  time: "13:30",
  offeringId: OFF,
  reservedAt: LAPSED,
  holdMinutes: 120,
  tripMinutes: 100,
  ...over,
});

describe("abandonedCheckouts — which rows are abandonment (§2.8.8)", () => {
  it("includes a lapsed public pending row", () => {
    const out = abandonedCheckouts([row()], NOW);
    expect(out).toHaveLength(1);
    expect(String(out[0]!.id)).toBe("r-1");
  });

  it("excludes a row still inside its payment window — that customer is still paying", () => {
    expect(abandonedCheckouts([row({ reservedAt: LIVE })], NOW)).toEqual([]);
  });

  it("excludes a booked row — it was not walked away from, it was bought", () => {
    expect(abandonedCheckouts([row({ status: "booked" })], NOW)).toEqual([]);
  });

  it("excludes a cancelled row", () => {
    expect(abandonedCheckouts([row({ status: "cancelled" })], NOW)).toEqual([]);
  });

  it("excludes an ADMIN pending row however old — it has no window and never lapses (DEC-163)", () => {
    // §2.8.8's first rule: branch on `source` first. An operator's booking sitting unpaid for a
    // fortnight is a phone booking waiting for its customer, not a checkout somebody abandoned.
    // Counting it here would put the operator's own work on a screen about strangers walking away.
    const ancient = row({ source: "admin", reservedAt: "2026-01-01T00:00:00.000Z" });
    expect(abandonedCheckouts([ancient], NOW)).toEqual([]);
  });

  it("excludes a row with no reserved time rather than guessing one", () => {
    // A Xola-imported or pre-14.4 row has no `reservedAt`. It has no window either, so it cannot
    // have lapsed — and dating it from anything else would be inventing the number the whole
    // screen exists to report.
    const { reservedAt: _drop, ...noReservedAt } = row();
    expect(abandonedCheckouts([noReservedAt as Reservation], NOW)).toEqual([]);
  });
});

describe("abandonedCheckouts — what each row reports", () => {
  it("carries the slot, the boat and the party — the facts §2.8.8 names", () => {
    const [got] = abandonedCheckouts([row({ partySize: 9 })], NOW);
    expect(got).toMatchObject({
      date: "2026-07-04",
      time: "13:30",
      vesselId: V,
      partySize: 9,
      reservedAt: LAPSED,
    });
  });

  it("reports whether the checkout reached the payment provider, and NOT what that means", () => {
    // The one genuinely two-valued fact on the row. A present id means a human was there with a
    // card; an absent one means the checkout never got that far — a script, a provider outage or
    // a dropped connection, three facts wearing one blank. The view reports the count and stops.
    const reached = abandonedCheckouts([row({ paymentIntentIds: ["pi_1", "pi_2"] })], NOW);
    expect(reached[0]!.paymentIntentCount).toBe(2);
    expect(abandonedCheckouts([row()], NOW)[0]!.paymentIntentCount).toBe(0);
  });

  it("groups repeat attempts by a HASH of the holder token, never the token", () => {
    // The token is an httpOnly possession credential — it is what proves a checkout is yours.
    // Its only job on this screen is showing that six rows are one determined customer rather
    // than six people, and a hash does that without putting a live credential on a page someone
    // can screenshot.
    const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";
    const [a, b] = abandonedCheckouts(
      [row({ id: asId<"ReservationId">("r-a"), holderToken: TOKEN }),
       row({ id: asId<"ReservationId">("r-b"), holderToken: TOKEN })],
      NOW,
    );
    expect(a!.session).toBe(b!.session); // same customer, same group
    expect(a!.session).not.toContain(TOKEN.slice(0, 8));
    expect(JSON.stringify(a)).not.toContain(TOKEN);
  });

  it("a tokenless row gets no session rather than sharing one with every other tokenless row", () => {
    // Two anonymous checkouts are not one customer. Collapsing them under a shared "none" bucket
    // would read as a single session with N attempts — exactly the abuse signal this column is
    // for, manufactured out of an absence.
    const [a, b] = abandonedCheckouts(
      [row({ id: asId<"ReservationId">("r-a") }), row({ id: asId<"ReservationId">("r-b") })],
      NOW,
    );
    expect(a!.session).toBeUndefined();
    expect(b!.session).toBeUndefined();
  });

  it("orders most recently reserved first", () => {
    const older = row({ id: asId<"ReservationId">("r-old"), reservedAt: "2026-07-04T09:00:00.000Z" });
    const newer = row({ id: asId<"ReservationId">("r-new"), reservedAt: "2026-07-04T11:00:00.000Z" });
    expect(abandonedCheckouts([older, newer], NOW).map((r) => String(r.id))).toEqual([
      "r-new",
      "r-old",
    ]);
  });
});

describe("summarizeAbandonment — the header facts", () => {
  const rows = (n: number, withIntent = 0): ReturnType<typeof abandonedCheckouts> =>
    abandonedCheckouts(
      Array.from({ length: n }, (_, i) =>
        row({
          id: asId<"ReservationId">(`r-${i}`),
          ...(i < withIntent ? { paymentIntentIds: [`pi_${i}`] } : {}),
        }),
      ),
      NOW,
    );

  it("counts the rows and states the window it was given", () => {
    expect(summarizeAbandonment(rows(3), 15)).toMatchObject({ total: 3, windowMinutes: 15 });
  });

  it("hull hours withheld is count × window — the number a too-long window shows up in", () => {
    // 12 checkouts × 15 min = 180 min = 3 hours of boat nobody could buy.
    expect(summarizeAbandonment(rows(12), 15).hullHoursWithheld).toBe(3);
    // …and it moves with the window, which is the comparison the operator is making.
    expect(summarizeAbandonment(rows(12), 30).hullHoursWithheld).toBe(6);
  });

  it("counts how many reached the payment provider, and asserts nothing about the rest", () => {
    expect(summarizeAbandonment(rows(5, 2), 15)).toMatchObject({ total: 5, reachedProvider: 2 });
  });

  it("an empty list summarizes to zeroes rather than throwing", () => {
    // The screen's first day, and every day nothing goes wrong.
    expect(summarizeAbandonment([], 15)).toEqual({
      total: 0,
      windowMinutes: 15,
      hullHoursWithheld: 0,
      reachedProvider: 0,
    });
  });
});
