/**
 * Cancel a Muster booking (#616) — the write that frees the boat, and the refund quote the
 * operator's confirm screen prefills from.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { Payment, Reservation } from "../domain/entities.js";
import { seedFleet } from "../import/resource-map.js";
import { formShifts } from "../builder/form-shifts.js";
import { cancelReservation, quoteCancelRefund } from "./cancel-reservation.js";

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
    await formShifts(repo);
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
    await formShifts(repo);
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

  it("keeps the FIRST answer when a half-applied cancel is re-run (#724)", async () => {
    // The repair path deliberately re-runs against an already-cancelled reservation. It must not
    // rewrite who cancelled: the first answer is the real one, and a retry that happened to be
    // driven from a different surface would otherwise silently relabel a customer cancellation
    // as ours — which is the branch that pays a FULL refund.
    const repo = await seeded();
    await cancelReservation(deps(repo), RESV, "customer");
    await cancelReservation(deps(repo), RESV, "operator");

    expect((await repo.getReservation(RESV))?.cancelledBy).toBe("customer");
  });

  it("is idempotent, and repairs a half-applied cancel", async () => {
    // The state a crash between the two writes leaves behind: reservation cancelled, event
    // still scheduled — the boat silently un-released. Re-running must finish the job rather
    // than short-circuit on "already cancelled".
    const repo = await seeded({ status: "cancelled" });
    const result = await cancelReservation(deps(repo), RESV, "operator");

    expect(result).toMatchObject({ ok: true, alreadyCancelled: true });
    expect((await repo.getEvent(EVENT))?.status).toBe("cancelled");
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
});

describe("quoteCancelRefund", () => {
  const departureAt = new Date("2026-08-20T21:00:00.000Z");
  const paid = [payment()];

  it("an OPERATOR cancellation refunds everything, at any notice", async () => {
    // Weather, crew, mechanical — "we will provide you with a full refund". The hour of the
    // departure is irrelevant, which is the whole reason `operatorCancelRefundCents` exists as
    // its own function.
    const q = quoteCancelRefund({
      by: "operator",
      payments: paid,
      departureAt,
      now: new Date("2026-08-20T19:00:00.000Z"), // two hours out
    });
    expect(q.refundCents).toBe(53625);
  });

  it("a CUSTOMER cancellation 14+ days out refunds what they paid minus the $50 fee", () => {
    const q = quoteCancelRefund({
      by: "customer",
      payments: paid,
      departureAt,
      now: new Date("2026-08-01T12:00:00.000Z"), // ~19 days out
    });
    expect(q.refundCents).toBe(53625 - 5000);
  });

  it("a CUSTOMER cancellation inside 14 days refunds nothing", () => {
    const q = quoteCancelRefund({
      by: "customer",
      payments: paid,
      departureAt,
      now: new Date("2026-08-15T12:00:00.000Z"), // ~5 days out
    });
    expect(q.refundCents).toBe(0);
  });

  it("quotes on FARE money only — the tip and the service fee are carved out", () => {
    // A tip is crew money (DEC-124) and the service fee is the operator's. Quoting them back
    // by default would hand out crew pay on a routine cancel with nobody deciding to. The
    // operator can type a larger number; they cannot un-send one that defaulted too high.
    const q = quoteCancelRefund({
      by: "operator",
      payments: [payment({ amountCents: 65125, gratuityCents: 10000, serviceFeeCents: 1500 })],
      departureAt,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(q.refundCents).toBe(53625);
  });

  it("nets money already refunded — the same dollar cannot be quoted twice", () => {
    const q = quoteCancelRefund({
      by: "operator",
      payments: [payment({ refundedCents: 20000, status: "partially_refunded" })],
      departureAt,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(q.refundCents).toBe(33625);
  });

  it("a fully refunded booking quotes zero, not a negative", () => {
    const q = quoteCancelRefund({
      by: "operator",
      payments: [payment({ refundedCents: 53625, status: "refunded" })],
      departureAt,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(q.refundCents).toBe(0);
  });
});
