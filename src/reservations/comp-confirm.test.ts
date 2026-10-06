/**
 * The comp confirm (16.5, DEC-194, SPEC §2.8.6) — a booking discounted to $0 has no payment id to
 * be found by, so it has a second, named way into the same flip: by its reservation id.
 */
import { describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { BookingInvoice, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { confirmCompedBooking } from "./confirm-booking.js";
import { confirmCompedRow } from "./write-booking.js";

const NOW = () => "2026-07-01T12:00:00.000Z";
const RESV = asId<"ReservationId">("resv-comp");
const VESSEL = asId<"VesselId">("v");

const comped: BookingInvoice = {
  fareCents: 50000,
  extrasCents: 0,
  discountCents: 50000,
  taxCents: 0,
  taxRateBps: 725,
  serviceFeeCents: 0,
  serviceFeeBps: 300,
  gratuityCents: 0,
  gratuityBps: 2000,
  totalCents: 0,
  amountDueNowCents: 0,
};

const row = (over: Partial<Reservation> = {}): Reservation => ({
  id: RESV,
  eventId: null,
  source: "admin",
  status: "pending",
  customerName: "Martin Brody",
  phone: "+12165550142",
  partySize: 4,
  vesselId: VESSEL,
  date: "2026-07-04",
  time: "17:00",
  offeringId: asId<"OfferingId">("off-1"),
  holdMinutes: 120,
  tripMinutes: 100,
  invoice: comped,
  updatedAt: NOW(),
  ...over,
});

async function seeded(r: Reservation = row()): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.saveVessel({ id: VESSEL, name: "Brew", coiMaxPax: 12, manning: [] });
  await repo.saveReservation(r);
  return repo;
}

describe("confirmCompedRow — the second lookup into the one flip", () => {
  it("books an operator's $0 row by its reservation id, and materializes its Event", async () => {
    const repo = await seeded();
    const res = await confirmCompedRow(repo, RESV, NOW);
    expect(res).toMatchObject({ outcome: "booked", soldBy: "admin" });
    const stored = (await repo.getReservation(RESV))!;
    expect(stored.status).toBe("booked");
    // The flip turns an admin row into `muster`, comp or paid alike (16.1).
    expect(stored.source).toBe("muster");
    expect(await repo.listEvents()).toHaveLength(1);
  });

  it("a second run is `already`, not a second booking", async () => {
    const repo = await seeded();
    await confirmCompedRow(repo, RESV, NOW);
    expect((await confirmCompedRow(repo, RESV, NOW)).outcome).toBe("already");
    expect(await repo.listEvents()).toHaveLength(1);
  });

  it("refuses a row with money due — that one is confirmed by its payment", async () => {
    const repo = await seeded(row({ invoice: { ...comped, discountCents: 10000, totalCents: 52400, amountDueNowCents: 52400 } }));
    expect(await confirmCompedRow(repo, RESV, NOW)).toEqual({ outcome: "unconfirmable", reason: "not_comp" });
    expect((await repo.getReservation(RESV))!.status).toBe("pending");
  });

  it("refuses a customer's checkout row — only the operator comps", async () => {
    const repo = await seeded(row({ source: "muster" }));
    expect(await confirmCompedRow(repo, RESV, NOW)).toEqual({ outcome: "unconfirmable", reason: "not_comp" });
  });

  it("refuses a row a payment was started on — that money has to be dealt with first", async () => {
    const repo = await seeded(row({ paymentIntentIds: ["pi_1"] }));
    expect(await confirmCompedRow(repo, RESV, NOW)).toEqual({ outcome: "unconfirmable", reason: "not_comp" });
  });

  it("refuses a cancelled row, and says there is no row for an unknown id", async () => {
    const repo = await seeded(row({ status: "cancelled" }));
    expect(await confirmCompedRow(repo, RESV, NOW)).toEqual({ outcome: "unconfirmable", reason: "not_pending" });
    expect(await confirmCompedRow(repo, asId<"ReservationId">("nope"), NOW)).toEqual({
      outcome: "unconfirmable",
      reason: "no_row",
    });
  });
});

describe("confirmCompedBooking — the comp runs the confirm's steps, minus the payment", () => {
  const deps = (repo: InMemoryRepository) => ({
    repo,
    now: NOW,
    sendConfirmation: vi.fn(async (_r: Reservation) => true),
  });

  it("records the sale as a comp sold by the operator, tells the customer, and records no payment", async () => {
    const repo = await seeded();
    const d = deps(repo);
    const res = await confirmCompedBooking(d, RESV);

    expect(res).toBe("booked");
    const [trail] = (await repo.listTrailEvents()).filter((e) => e.type === "booked");
    expect(trail).toMatchObject({ actorKind: "admin", metadata: { via: "comp" } });
    expect(d.sendConfirmation).toHaveBeenCalledTimes(1);
    expect(await repo.listPaymentsForReservation(RESV)).toEqual([]);
  });

  it("a repeat tells nobody twice", async () => {
    const repo = await seeded();
    const d = deps(repo);
    await confirmCompedBooking(d, RESV);
    expect(await confirmCompedBooking(d, RESV)).toBe("already");
    expect(d.sendConfirmation).toHaveBeenCalledTimes(1);
  });

  it("a row that is not a comp books nothing", async () => {
    const repo = await seeded(row({ source: "muster" }));
    expect(await confirmCompedBooking(deps(repo), RESV)).toBe("unconfirmable");
    expect((await repo.getReservation(RESV))!.status).toBe("pending");
  });
});
