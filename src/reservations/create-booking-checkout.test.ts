/**
 * createBookingCheckout (11.2) — driven against the in-memory repo + FakePaymentPort.
 */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { createBookingCheckout } from "./create-booking-checkout.js";

const EVENT = asId<"EventId">("m-evt-1");
const URLS = { successUrl: "https://x/success", cancelUrl: "https://x/cancel" };

const musterEvent = (over: Partial<Event> = {}): Event => ({
  id: EVENT,
  vesselId: asId<"VesselId">("v"),
  date: "2026-07-04",
  time: "17:00",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 50000, // $500.00 in cents
  ...over,
});

const req = { eventId: EVENT, customerName: "Mary", partySize: 6, email: "m@x.io" };

describe("createBookingCheckout", () => {
  it("full mode: charges price + Ohio tax, writes nothing, returns the checkout url + metadata", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    await repo.setPaymentConfig({ depositMode: "full", taxRateBps: 725 }, "now");
    const pay = new FakePaymentPort();

    const r = await createBookingCheckout(repo, pay, req, URLS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toContain("cs_fake_");
    // tax = round(50000 * 725 / 10000) = 3625; full = 53625
    expect(pay.created[0]!.amountCents).toBe(53625);
    expect(pay.created[0]!.taxCents).toBe(3625);
    expect(pay.created[0]!.metadata).toMatchObject({
      eventId: "m-evt-1",
      partySize: "6",
      kind: "full",
      taxCents: "3625",
      customerName: "Mary",
      email: "m@x.io",
    });
    // does NOT write a reservation — the webhook does
    expect(await repo.listReservationsForEvent(EVENT)).toHaveLength(0);
  });

  it("deposit mode: charges the deposit share + full tax; kind='deposit'", async () => {
    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    await repo.setPaymentConfig({ depositMode: "deposit", depositPercent: 25, taxRateBps: 725 }, "now");
    const pay = new FakePaymentPort();

    await createBookingCheckout(repo, pay, req, URLS);
    // deposit = round(50000 * 25 / 100) = 12500; + tax 3625 = 16125
    expect(pay.created[0]!.amountCents).toBe(16125);
    expect(pay.created[0]!.metadata.kind).toBe("deposit");
  });

  it("rejects: missing / not-sellable / unpriced / bad party / already-claimed", async () => {
    const pay = new FakePaymentPort();

    const empty = new InMemoryRepository();
    expect(await createBookingCheckout(empty, pay, req, URLS)).toMatchObject({ reason: "event_missing" });

    const xola = new InMemoryRepository();
    await xola.saveEvent(musterEvent({ source: "xola" }));
    expect(await createBookingCheckout(xola, pay, req, URLS)).toMatchObject({ reason: "not_sellable" });

    const unpriced = new InMemoryRepository();
    const { price: _price, ...noPrice } = musterEvent();
    await unpriced.saveEvent(noPrice);
    expect(await createBookingCheckout(unpriced, pay, req, URLS)).toMatchObject({ reason: "unpriced" });

    const repo = new InMemoryRepository();
    await repo.saveEvent(musterEvent());
    expect(await createBookingCheckout(repo, pay, { ...req, partySize: 13 }, URLS)).toMatchObject({ reason: "invalid_party" });

    // already claimed: an active muster reservation holds the boat
    await repo.saveReservation({
      id: asId<"ReservationId">("r-held"),
      eventId: EVENT,
      source: "muster",
      customerName: "Rival",
      partySize: 4,
      status: "booked",
    });
    expect(await createBookingCheckout(repo, pay, req, URLS)).toMatchObject({ reason: "already_claimed" });
  });
});
