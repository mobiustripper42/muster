/**
 * Cancel a Muster booking (#616) — the write that frees the boat, and the refund quote the
 * operator's confirm screen prefills from.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Payment, Reservation } from "../domain/entities.js";
import { seedFleet } from "../import/resource-map.js";
import { cancelReservation, cancelUnpaidPhoneBooking, quoteCancelRefund } from "./cancel-reservation.js";
import { formAllVesselDaysForTest } from "../builder/form-all-test-support.js";

const VESSEL = asId<"VesselId">("vessel-brew-2"); // 2-crew, seeded by the fleet
const EVENT = asId<"EventId">("slot_vessel-brew-2|2026-08-20|17:00");
const RESV = asId<"ReservationId">("resv-cancel-1");
const NOW = "2026-08-01T12:00:00.000Z";

async function seeded(over: Partial<Reservation> = {}): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await seedFleet(repo);
  await repo.saveEvent({
    id: EVENT,
    vesselId: VESSEL,
    date: "2026-08-20",
    time: "17:00",
    capacity: 16,
    status: "scheduled",
    source: "muster",
    price: 50000,
  });
  await repo.saveReservation({
    id: RESV,
    eventId: EVENT,
    source: "muster",
    customerName: "Ann",
    partySize: 4,
    status: "booked",
    ...over,
  });
  return repo;
}

const deps = (repo: InMemoryRepository, relay?: (f: unknown) => Promise<void>) => ({
  repo,
  now: () => NOW,
  ...(relay ? { relayFormNotices: relay as never } : {}),
});

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: asId<"PaymentId">("pay-1"),
  reservationId: RESV,
  method: "stripe",
  kind: "full",
  amountCents: 53625,
  taxCents: 3625,
  currency: "usd",
  status: "succeeded",
  createdAt: NOW,
  ...over,
});

describe("cancelReservation", () => {
  it("cancels the reservation AND its event — the event is what releases the hull", async () => {
    const repo = await seeded();
    const result = await cancelReservation(deps(repo), RESV, "operator");

    expect(result.ok).toBe(true);
    expect((await repo.getReservation(RESV))?.status).toBe("cancelled");
    // The half a reservation-only cancel misses: every neighbouring departure on this hull
    // stays blocked while the event reads `scheduled` (proven against real Postgres in
    // `postgres-repository.test.ts`, "the EVENT is what frees the neighbouring departures").
    expect((await repo.getEvent(EVENT))?.status).toBe("cancelled");
  });

  it("collapses the shift and reports the crew who are now off", async () => {
    const repo = await seeded();
    // A formed, crewed shift on the day being cancelled.
    await formAllVesselDaysForTest(repo);
    const shiftId = asId<"ShiftId">(`shift-${VESSEL}-2026-08-20`);
    const seats = await repo.listSeatsForShift(shiftId);
    expect(seats.length).toBeGreaterThan(0);
    await repo.saveSeat({
      ...seats[0]!,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("crew-quint"),
    });

    const relayed: unknown[] = [];
    await cancelReservation(
      deps(repo, async (f) => {
        relayed.push(f);
      }),
      RESV,
      "operator",
    );

    expect((await repo.getShift(shiftId))?.state).toBe("Cancelled");
    // The crew member has to be TOLD. `formShifts` emits `cancelledCrew`; if the result is
    // computed and dropped (the mistake #614's review caught on the booking side) the shift
    // still collapses and nobody hears about it — so assert the relay, not just the state.
    expect(relayed).toHaveLength(1);
    expect((relayed[0] as { cancelledCrew: unknown[] }).cancelledCrew).toHaveLength(1);
  });

  it("a cancellation that SHRINKS a still-live day tells that crew too (#765)", async () => {
    // The sibling of the collapse above, and the half that was silent. When the cancelled trip is
    // the day's ONLY trip the shift collapses and `cancelledCrew` fires — that path is ungated and
    // always worked. When the day has other trips the shift SURVIVES with a smaller trip set, so
    // the change lands in `changedCrew`, which was gated off here. The crew member keeps a shift
    // whose shape moved under them — plausibly a different call time — and was told nothing.
    const repo = await seeded();
    // A second trip on the same hull that day, so cancelling the first cannot collapse the shift.
    await repo.saveEvent({
      id: asId<"EventId">("slot_vessel-brew-2|2026-08-20|12:00"),
      vesselId: VESSEL,
      date: "2026-08-20",
      time: "12:00",
      capacity: 16,
      status: "scheduled",
      source: "muster",
      price: 50000,
    });
    await formAllVesselDaysForTest(repo);
    const shiftId = asId<"ShiftId">(`shift-${VESSEL}-2026-08-20`);
    const seats = await repo.listSeatsForShift(shiftId);
    await repo.saveSeat({
      ...seats[0]!,
      state: "Confirmed",
      assignedCrewMemberId: asId<"CrewMemberId">("crew-quint"),
    });
    expect((await repo.getShift(shiftId))?.eventIds).toHaveLength(2);

    const relayed: unknown[] = [];
    await cancelReservation(
      deps(repo, async (f) => {
        relayed.push(f);
      }),
      RESV,
      "operator",
    );

    // The shift is still live and still crewed — it just lost a trip.
    expect((await repo.getShift(shiftId))?.state).not.toBe("Cancelled");
    expect((await repo.getShift(shiftId))?.eventIds).toHaveLength(1);

    expect(relayed).toHaveLength(1);
    const form = relayed[0] as {
      cancelledCrew: unknown[];
      changedCrew: { crewMemberId: string }[];
    };
    // Not "you're off" — they are still on the boat. "Your shift changed".
    expect(form.cancelledCrew).toEqual([]);
    expect(form.changedCrew.map((c) => String(c.crewMemberId))).toEqual(["crew-quint"]);
  });

  it("refuses a Xola reservation — Xola owns its own bookings (DEC-105)", async () => {
    const repo = await seeded({ source: "xola" });
    const result = await cancelReservation(deps(repo), RESV, "operator");

    expect(result).toMatchObject({ ok: false, reason: "not_muster" });
    expect((await repo.getReservation(RESV))?.status).toBe("booked");
    expect((await repo.getEvent(EVENT))?.status).toBe("scheduled");
  });

  it("refuses a PENDING row — §3.3 acts on money, and nobody has paid (14.3, SPEC §2.8.10)", async () => {
    // A refused outcome, not a throw: 14.2 threw from `eventIdOfBooked` with nothing written,
    // which was safe but a defect-shaped answer to a state-shaped question.
    const repo = await seeded({ status: "pending", eventId: null });
    const result = await cancelReservation(deps(repo), RESV, "operator");

    expect(result).toEqual({ ok: false, reason: "not_booked" });
    expect((await repo.getReservation(RESV))?.status).toBe("pending");
    expect((await repo.getEvent(EVENT))?.status).toBe("scheduled");
  });

  describe("an operator's UNPAID phone booking (16.1, DEC-163)", () => {
    // It never lapses, so a person is the only thing that ends it. Nobody has paid, so there is
    // nothing to refund and no Event to release — the hull frees when the row stops being pending.
    const unpaid: Partial<Reservation> = {
      source: "admin",
      status: "pending",
      eventId: null,
      vesselId: VESSEL,
      date: "2026-08-20",
      time: "17:00",
      holdMinutes: 120,
      tripMinutes: 100,
    };

    it("cancels, and records that the operator did it", async () => {
      const repo = await seeded(unpaid);
      const result = await cancelReservation(deps(repo), RESV, "operator");

      expect(result).toEqual({ ok: true, alreadyCancelled: false });
      expect(await repo.getReservation(RESV)).toMatchObject({
        status: "cancelled",
        cancelledBy: "operator",
        updatedAt: NOW,
      });
      // Not its Event to cancel — a pending row has none, and this one belongs to nobody here.
      expect((await repo.getEvent(EVENT))?.status).toBe("scheduled");
    });

    it("re-running on one already cancelled is fine and writes nothing", async () => {
      const repo = await seeded({ ...unpaid, status: "cancelled", cancelledBy: "operator" });
      expect(await cancelReservation(deps(repo), RESV, "customer")).toEqual({
        ok: true,
        alreadyCancelled: true,
      });
      expect((await repo.getReservation(RESV))?.cancelledBy).toBe("operator");
    });

    it("refuses if the customer paid while the operator was pressing cancel — never cancels a paid booking", async () => {
      const repo = await seeded(unpaid);
      // The race: the payment's confirm flips the row between this function's read and its write.
      const real = repo.cancelPendingIfUnpaid.bind(repo);
      repo.cancelPendingIfUnpaid = async (id, by, at) => {
        const row = (await repo.getReservation(id))!;
        await repo.saveReservation({ ...row, status: "booked", source: "muster", eventId: EVENT });
        return real(id, by, at);
      };

      expect(await cancelReservation(deps(repo), RESV, "operator")).toEqual({ ok: false, reason: "now_booked" });
      expect(await repo.getReservation(RESV)).toMatchObject({ status: "booked", source: "muster" });
      expect((await repo.getEvent(EVENT))?.status).toBe("scheduled");
    });

    it("a STALE phone-cancel form on a booking paid since it opened refuses — never the paid-booking cancel", async () => {
      // The operator opens the confirm, the customer pays (the row is now `muster`, booked, with
      // an Event), the operator submits. `cancelReservation` would take that row down its ordinary
      // booked path — Event cancelled, no refund, no crew told — under a screen that just said
      // "nothing was paid". The phone path must refuse anything that is not still a phone booking.
      const repo = await seeded(); // booked, `muster`, on EVENT: what a paid phone booking becomes
      expect(await cancelUnpaidPhoneBooking(deps(repo), RESV, "operator")).toEqual({
        ok: false,
        reason: "now_booked",
      });
      expect((await repo.getReservation(RESV))?.status).toBe("booked");
      expect((await repo.getEvent(EVENT))?.status).toBe("scheduled");
    });

    it("the phone path cancels an unpaid phone booking like cancelReservation does", async () => {
      const repo = await seeded(unpaid);
      expect(await cancelUnpaidPhoneBooking(deps(repo), RESV, "customer")).toEqual({
        ok: true,
        alreadyCancelled: false,
      });
      expect((await repo.getReservation(RESV))?.cancelledBy).toBe("customer");
    });
  });

  it("records WHO cancelled — the answer the refund turned on and nothing kept (#724)", async () => {
    // The confirm already asks customer-vs-operator, because the refund policy branches on it
    // (`quoteCancelRefund`). Until now that answer picked a policy and was thrown away: the
    // refund AMOUNT was the only surviving trace, and the operator can type over the amount.
    // So "why was this cancelled" — and "how many trips did we lose to weather" — were
    // unanswerable from the database, permanently, for every booking already cancelled.
    const repo = await seeded();
    await cancelReservation(deps(repo), RESV, "operator");

    expect((await repo.getReservation(RESV))?.cancelledBy).toBe("operator");
  });

  it("records a CUSTOMER cancellation as the customer's", async () => {
    const repo = await seeded();
    await cancelReservation(deps(repo), RESV, "customer");

    expect((await repo.getReservation(RESV))?.cancelledBy).toBe("customer");
  });

  it("AC11: a booking already cancelled answers alreadyCancelled and writes nothing — there is no repair to re-run", async () => {
    // Who cancelled stands: a press from a different surface would otherwise relabel a customer
    // cancellation as ours, which is the branch that pays a FULL refund (#724). The Event left
    // scheduled is deliberate: this state can no longer be created, and nothing here repairs it.
    const repo = await seeded({ status: "cancelled", cancelledBy: "customer" });
    const relayed: unknown[] = [];

    const result = await cancelReservation(
      deps(repo, async (f) => {
        relayed.push(f);
      }),
      RESV,
      "operator",
    );

    expect(result).toEqual({ ok: true, alreadyCancelled: true });
    expect((await repo.getReservation(RESV))?.cancelledBy).toBe("customer");
    expect((await repo.getEvent(EVENT))?.status).toBe("scheduled");
    expect(relayed).toEqual([]);
  });

  it("leaves the event alone when another active booking still holds it", async () => {
    // The whole-boat mutex means this should not arise, but cancelling one party's booking
    // must never release a boat somebody else is still on.
    const repo = await seeded();
    await repo.saveReservation({
      id: asId<"ReservationId">("resv-other"),
      eventId: EVENT,
      source: "muster",
      customerName: "Ben",
      partySize: 2,
      status: "booked",
    });

    await cancelReservation(deps(repo), RESV, "operator");

    expect((await repo.getReservation(RESV))?.status).toBe("cancelled");
    expect((await repo.getEvent(EVENT))?.status).toBe("scheduled");
  });

  it("the loser of two racing cancels writes nothing and leaves the release to the winner (PR #1214 review)", async () => {
    // Both presses read `booked` before either wrote. A whole-row save from each read let both own
    // the cancel: both relabelled `cancelledBy`, both re-formed and relayed, and both callers went
    // on to refund. The winner has already cancelled here; the loser's read is stale.
    const repo = await seeded();
    await cancelReservation(deps(repo), RESV, "customer");
    const real = repo.getReservation.bind(repo);
    repo.getReservation = async (id) => {
      const row = await real(id);
      if (!row) return row;
      const { cancelledBy: _by, ...live } = row;
      return { ...live, status: "booked" };
    };
    const relayed: unknown[] = [];

    const result = await cancelReservation(
      deps(repo, async (f) => {
        relayed.push(f);
      }),
      RESV,
      "operator",
    );

    expect(result).toEqual({ ok: true, alreadyCancelled: true });
    expect((await real(RESV))?.cancelledBy).toBe("customer");
    expect(relayed).toEqual([]);
  });

  it("AC7: a booked Muster row goes through the one write, carries no releaseFailed, and re-forms as it did", async () => {
    const repo = await seeded();
    await formAllVesselDaysForTest(repo);
    const writes: unknown[][] = [];
    const real = repo.cancelBookingAndRelease.bind(repo);
    repo.cancelBookingAndRelease = async (...args) => {
      writes.push(args);
      return real(...args);
    };
    const relayed: unknown[] = [];

    const result = await cancelReservation(
      deps(repo, async (f) => {
        relayed.push(f);
      }),
      RESV,
      "operator",
    );

    expect(writes).toEqual([[RESV, EVENT, "operator", NOW]]);
    expect(result).toEqual({ ok: true, alreadyCancelled: false, freedEventId: EVENT });
    expect(relayed).toHaveLength(1);
    expect((await repo.getShift(asId<"ShiftId">(`shift-${VESSEL}-2026-08-20`)))?.state).toBe("Cancelled");
  });

  it("AC7: a write that throws is thrown — nothing happened, so nothing re-forms and nobody is told", async () => {
    const repo = await seeded();
    repo.cancelBookingAndRelease = async () => {
      throw new Error("hull-day lock timed out");
    };
    const relayed: unknown[] = [];

    await expect(
      cancelReservation(
        deps(repo, async (f) => {
          relayed.push(f);
        }),
        RESV,
        "customer",
      ),
    ).rejects.toThrow("hull-day lock timed out");

    expect((await repo.getReservation(RESV))?.status).toBe("booked");
    expect((await repo.getEvent(EVENT))?.status).toBe("scheduled");
    expect(relayed).toEqual([]);
  });

  it("AC4: a cancel that released nothing is still this press's cancel — it frees no event, and the re-form runs", async () => {
    // A `released: false` read as a lost press would answer alreadyCancelled, and no refund follows.
    const repo = await seeded();
    repo.cancelBookingAndRelease = async () => ({ cancelled: true, released: false });
    const relayed: unknown[] = [];

    const result = await cancelReservation(
      deps(repo, async (f) => {
        relayed.push(f);
      }),
      RESV,
      "operator",
    );

    expect(result).toEqual({ ok: true, alreadyCancelled: false });
    expect(relayed).toHaveLength(1);
  });

  it("AC11: a write that changed nothing is a lost press — alreadyCancelled, and no re-form", async () => {
    const repo = await seeded();
    repo.cancelBookingAndRelease = async () => ({ cancelled: false, released: false });
    const relayed: unknown[] = [];

    const result = await cancelReservation(
      deps(repo, async (f) => {
        relayed.push(f);
      }),
      RESV,
      "operator",
    );

    expect(result).toEqual({ ok: true, alreadyCancelled: true });
    expect(relayed).toEqual([]);
  });
});

describe("quoteCancelRefund", () => {
  const departureAt = new Date("2026-08-20T21:00:00.000Z");
  const paid = [payment()];

  /**
   * The booking from #797, to the cent: $754.15 taken, of which $115.80 is tip and $17.37 is the
   * service fee. **Every rule below is asserted against a payment that carries both**, because a
   * tip-free payment cannot tell a full refund from a fare-only one — which is exactly how the
   * defect survived a test named "refunds everything" for as long as it did.
   */
  const paidWithTipAndFee = [
    payment({ amountCents: 75415, gratuityCents: 11580, serviceFeeCents: 1737 }),
  ];

  it("an OPERATOR cancellation refunds everything, at any notice", async () => {
    // Weather, crew, mechanical — "we will provide you with a full refund". The hour of the
    // departure is irrelevant, which is the whole reason `operatorCancelRefundCents` exists as
    // its own function.
    //
    // **Everything means everything**: the published term names no deduction on this branch, so
    // the tip and the service fee come back with the fare. Quoting $620.98 here is #797.
    const q = quoteCancelRefund({
      by: "operator",
      payments: paidWithTipAndFee,
      departureAt,
      insurance: null,
      now: new Date("2026-08-20T19:00:00.000Z"), // two hours out
    });
    expect(q.refundCents).toBe(75415);
  });

  it("a CUSTOMER cancellation 14+ days out refunds what they paid minus the $50 fee", () => {
    const q = quoteCancelRefund({
      by: "customer",
      payments: paid,
      departureAt,
      insurance: null,
      now: new Date("2026-08-01T12:00:00.000Z"), // ~19 days out
    });
    expect(q.refundCents).toBe(53625 - 5000);
  });

  it("a CUSTOMER cancellation 14+ days out deducts the $50 and nothing else", () => {
    // "will be refunded minus a $50 cancellation fee" names ONE deduction. The tip and the
    // service fee are not a second and a third.
    const q = quoteCancelRefund({
      by: "customer",
      payments: paidWithTipAndFee,
      departureAt,
      insurance: null,
      now: new Date("2026-08-01T12:00:00.000Z"), // ~19 days out
    });
    expect(q.refundCents).toBe(75415 - 5000);
  });

  it("a CUSTOMER cancellation inside 14 days refunds nothing", () => {
    const q = quoteCancelRefund({
      by: "customer",
      payments: paid,
      departureAt,
      insurance: null,
      now: new Date("2026-08-15T12:00:00.000Z"), // ~5 days out
    });
    expect(q.refundCents).toBe(0);
  });

  it("with cancellation insurance, 72 hours out refunds everything but the insurance, no $50 (16.8)", () => {
    const insured = [payment({ amountCents: 53625 + 3000, flexCents: 3000 })];
    const at = (now: string) =>
      quoteCancelRefund({ by: "customer", payments: insured, departureAt, insurance: { chargedCents: 3000 }, now: new Date(now) });
    expect(at("2026-08-15T12:00:00.000Z").refundCents).toBe(53625); // ~5 days out
    expect(at("2026-08-19T12:00:00.000Z").refundCents).toBe(0); // inside 72 hours
    // The same five days without insurance is nothing.
    expect(quoteCancelRefund({ by: "customer", payments: insured, departureAt, insurance: null, now: new Date("2026-08-15T12:00:00.000Z") }).refundCents).toBe(0);
    // We cancel: everything back, the insurance included.
    expect(quoteCancelRefund({ by: "operator", payments: insured, departureAt, insurance: { chargedCents: 3000 }, now: new Date("2026-08-19T12:00:00.000Z") }).refundCents).toBe(53625 + 3000);
  });

  it("nets money already refunded — the same dollar cannot be quoted twice", () => {
    const q = quoteCancelRefund({
      by: "operator",
      payments: [payment({ refundedCents: 20000, status: "partially_refunded" })],
      departureAt,
      insurance: null,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(q.refundCents).toBe(33625);
  });

  it("a fully refunded booking quotes zero, not a negative", () => {
    const q = quoteCancelRefund({
      by: "operator",
      payments: [payment({ refundedCents: 53625, status: "refunded" })],
      departureAt,
      insurance: null,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(q.refundCents).toBe(0);
  });
});
