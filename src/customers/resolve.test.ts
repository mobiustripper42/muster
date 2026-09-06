/**
 * Booking-time customer resolution (12.12b, DEC-132) — the seam that keeps `customers` live
 * rather than a one-time backfill museum.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Customer } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import { customerIdForPhone, resolveCustomerId } from "./resolve.js";

const NOW = "2026-07-22T12:00:00.000Z";
const now = () => NOW;
/** Deterministic mints: every code is C-000000 unless a test says otherwise. */
const zero = () => 0;

const repo = () => new InMemoryRepository();

describe("resolveCustomerId", () => {
  it("creates a customer on a first booking and returns its id", async () => {
    const r = repo();
    const id = await resolveCustomerId(
      r,
      { customerName: "Jordan Ellis", phone: "(216) 555-0148" },
      now,
      zero,
    );
    expect(id).toBe(customerIdForPhone("+12165550148"));

    const saved = (await r.listCustomers())[0]!;
    expect(saved).toMatchObject({
      name: "Jordan Ellis",
      phoneE164: "+12165550148",
      displayCode: "C-000000",
      createdAt: NOW,
      active: true,
    });
  });

  it("reuses the existing customer on a second booking from the same phone, however typed", async () => {
    const r = repo();
    const first = await resolveCustomerId(
      r,
      { customerName: "Jordan Ellis", phone: "216-555-0148" },
      now,
      zero,
    );
    const second = await resolveCustomerId(
      r,
      { customerName: "J. Ellis", phone: "+1 (216) 555 0148" },
      now,
      zero,
    );
    expect(second).toBe(first);
    expect(await r.listCustomers()).toHaveLength(1);
    // The existing record wins — a later booking's name doesn't overwrite the contact.
    expect((await r.listCustomers())[0]!.name).toBe("Jordan Ellis");
  });

  it("keeps different phones as different customers", async () => {
    const r = repo();
    const a = await resolveCustomerId(r, { customerName: "A", phone: "2165550148" }, now, zero);
    const b = await resolveCustomerId(r, { customerName: "B", phone: "4405550102" }, now, zero);
    expect(a).not.toBe(b);
    expect(await r.listCustomers()).toHaveLength(2);
  });

  it("carries email onto a newly created customer, and omits it when absent", async () => {
    const r = repo();
    await resolveCustomerId(
      r,
      { customerName: "A", phone: "2165550148", email: "a@example.com" },
      now,
      zero,
    );
    expect((await r.listCustomers())[0]!.email).toBe("a@example.com");

    const r2 = repo();
    await resolveCustomerId(r2, { customerName: "B", phone: "4405550102" }, now, zero);
    expect("email" in (await r2.listCustomers())[0]!).toBe(false);
  });

  it("returns undefined — never throws — when the phone can't be canonicalized", async () => {
    const r = repo();
    for (const phone of [undefined, "", "555", "not a phone", "0165550148"]) {
      expect(
        await resolveCustomerId(r, { customerName: "X", phone }, now, zero),
      ).toBeUndefined();
    }
    // A paid booking must never be lost to a phone parse — nothing was created either.
    expect(await r.listCustomers()).toHaveLength(0);
  });

  it("retries with a fresh display code when one collides, then succeeds", async () => {
    const r = repo();
    let calls = 0;
    const flaky: Repository = Object.assign(Object.create(Object.getPrototypeOf(r)), r, {
      getCustomerByPhone: async () => null,
      getOrCreateCustomerByPhone: async (c: Customer) => {
        calls++;
        if (calls === 1) throw new Error("display_code collision");
        return { customer: c, created: true };
      },
    });
    const id = await resolveCustomerId(
      flaky,
      { customerName: "A", phone: "2165550148" },
      now,
      zero,
    );
    expect(calls).toBe(2);
    expect(id).toBe(customerIdForPhone("+12165550148"));
  });

  it("gives up after the retry budget rather than looping forever", async () => {
    const r = repo();
    let calls = 0;
    const always: Repository = Object.assign(Object.create(Object.getPrototypeOf(r)), r, {
      getCustomerByPhone: async () => null,
      getOrCreateCustomerByPhone: async () => {
        calls++;
        throw new Error("display_code collision");
      },
    });
    await expect(
      resolveCustomerId(always, { customerName: "A", phone: "2165550148" }, now, zero),
    ).rejects.toThrow(/collision/);
    expect(calls).toBe(3);
  });
});

describe("customerIdForPhone", () => {
  it("is deterministic and phone-derived", () => {
    expect(customerIdForPhone("+12165550148")).toBe("cust-12165550148");
    expect(customerIdForPhone("+12165550148")).toBe(customerIdForPhone("+12165550148"));
  });
  it("differs per phone", () => {
    expect(customerIdForPhone("+12165550148")).not.toBe(customerIdForPhone("+14405550102"));
  });
});

describe("booking paths link the customer (the anti-museum guarantee)", () => {
  // The customer is resolved when confirm FLIPS the pending row (§2.8.6 step 4), off the row's
  // frozen name and phone — not at checkout, where the row is written before Stripe (14.4).
  const pendingRow = (over: Partial<import("../domain/entities.js").Reservation> = {}) => ({
    id: asId<"ReservationId">("resv-pend"),
    eventId: null,
    source: "muster" as const,
    status: "pending" as const,
    customerName: "Jordan Ellis",
    partySize: 6,
    phone: "216-555-0148",
    vesselId: asId<"VesselId">("v1"),
    date: "2026-08-12",
    time: "13:30",
    offeringId: asId<"OfferingId">("off-1"),
    reservedAt: NOW,
    holdMinutes: 120,
    tripMinutes: 100,
    paymentIntentId: "pi_1",
    ...over,
  });
  async function seeded(row = pendingRow()) {
    const { confirmPendingRow } = await import("../reservations/write-booking.js");
    const r = repo();
    await r.saveVessel({ id: asId<"VesselId">("v1"), name: "Brew 1", coiMaxPax: 12, manning: [] });
    await r.saveReservation(row);
    return { r, confirmPendingRow };
  }

  it("confirmPendingRow stamps customerId on the flipped row", async () => {
    const { r, confirmPendingRow } = await seeded();
    const res = await confirmPendingRow(r, { paymentIntentId: "pi_1", priceCents: 49900 }, now);
    expect(res.outcome).toBe("booked");
    if (res.outcome !== "booked") return;
    expect(res.reservation.customerId).toBe(customerIdForPhone("+12165550148"));

    const history = await r.listReservationsForCustomer(customerIdForPhone("+12165550148"));
    expect(history).toHaveLength(1);
  });

  it("confirmPendingRow still books when the phone is unusable — just unlinked", async () => {
    // A phone that cannot canonicalize resolves to no customer — the row books, stays unlinked.
    const { r, confirmPendingRow } = await seeded(pendingRow({ phone: "555" }));
    const res = await confirmPendingRow(r, { paymentIntentId: "pi_1", priceCents: 49900 }, now);
    expect(res.outcome).toBe("booked");
    if (res.outcome !== "booked") return;
    expect("customerId" in res.reservation).toBe(false);
    expect(await r.listCustomers()).toHaveLength(0);
  });
});
