/**
 * The operator's cancel-and-refund (issue #1212), moved out of the `"use server"` file so all its
 * exits reach one send and can be tested. `cancelBooking` never had a test: these pin each exit's
 * redirect params and draft call as well as what the customer hears, because the move has to
 * preserve them exactly.
 *
 * Every refund figure is against a payment that carries tax, a tip and a service fee, for the
 * reason `cancel-reservation.test.ts` gives (#797).
 */
import { describe, expect, it } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { BookingInvoice, Event, Payment, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { seedFleet } from "../import/resource-map.js";
import type { ChannelPort, OutboundMessage } from "../ports/channel.js";
import { deliverCancelNotice, type CancelNoticeRefund, type TellCustomer } from "./cancel-notice.js";
import { cancelByOperator, type OperatorCancelInput } from "./operator-cancel.js";

const VESSEL = asId<"VesselId">("vessel-brew-2"); // seeded by the fleet
const RESV = asId<"ReservationId">("resv-operator-cancel-1");
const ADMIN = "crew-admin-1";
const NOW = "2026-11-01T16:00:00.000Z";

/** 27 days out — outside the 14-day window. */
const FAR = { date: "2026-11-28", time: "15:30" };
/** 5 days out — inside it, so the customer's terms owe $0. */
const NEAR = { date: "2026-11-06", time: "15:30" };

const eventIdOf = (slot: { date: string; time: string }) => asId<"EventId">(`slot_${VESSEL}|${slot.date}|${slot.time}`);

/** $644 paid: $594 back if the customer asked, all of it if we cancelled. */
const PAID = 64400;
const CUSTOMER_REFUND = 59400;

const INVOICE: BookingInvoice = {
  fareCents: 50000,
  extrasCents: 0,
  taxCents: 4000,
  taxRateBps: 800,
  serviceFeeCents: 400,
  serviceFeeBps: 300,
  gratuityCents: 10000,
  gratuityBps: 2000,
  totalCents: PAID,
  amountDueNowCents: PAID,
};

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: asId<"PaymentId">("pay-full"),
  reservationId: RESV,
  method: "stripe",
  kind: "full",
  amountCents: PAID,
  taxCents: 4000,
  gratuityCents: 10000,
  serviceFeeCents: 400,
  currency: "usd",
  status: "succeeded",
  stripePaymentIntentId: "pi_full",
  createdAt: "2026-10-01T10:00:00.000Z",
  ...over,
});

/** A $444 deposit and a $200 balance: a refund takes the balance whole, then fails on the deposit. */
const TWO_CHARGES = [
  payment({ id: asId<"PaymentId">("pay-deposit"), kind: "deposit", amountCents: 44400, stripePaymentIntentId: "pi_deposit" }),
  payment({
    id: asId<"PaymentId">("pay-balance"),
    kind: "balance",
    amountCents: 20000,
    taxCents: 0,
    gratuityCents: 0,
    serviceFeeCents: 0,
    stripePaymentIntentId: "pi_balance",
    createdAt: "2026-10-20T10:00:00.000Z",
  }),
];

const event = (slot = FAR, over: Partial<Event> = {}): Event => ({
  id: eventIdOf(slot),
  vesselId: VESSEL,
  date: slot.date,
  time: slot.time,
  capacity: 16,
  status: "scheduled",
  source: "muster",
  price: 50000,
  ...over,
});

const reservation = (slot = FAR, over: Partial<Reservation> = {}): Reservation => ({
  id: RESV,
  eventId: eventIdOf(slot),
  source: "muster",
  customerName: "Rhea Tallis",
  partySize: 6,
  status: "booked",
  invoice: INVOICE,
  email: "rhea@example.com",
  phone: "+12165550199",
  date: slot.date,
  time: slot.time,
  ...over,
});

interface World {
  slot?: { date: string; time: string };
  reservation?: Partial<Reservation>;
  payments?: Payment[];
  noEvent?: boolean;
}

async function seeded(w: World = {}): Promise<InMemoryRepository> {
  const slot = w.slot ?? FAR;
  const repo = new InMemoryRepository();
  await seedFleet(repo);
  if (!w.noEvent) await repo.saveEvent(event(slot));
  await repo.saveReservation(reservation(slot, w.reservation));
  for (const p of w.payments ?? [payment()]) await repo.savePayment(p);
  return repo;
}

const input = (over: Partial<OperatorCancelInput> = {}): OperatorCancelInput => ({
  reservationId: RESV,
  by: "operator",
  typedAmount: "",
  expectedRefunded: "0",
  adminId: ADMIN,
  ...over,
});

const deps = (repo: InMemoryRepository, payments = new FakePaymentPort(), tellCustomer?: TellCustomer) => ({
  repo,
  now: () => NOW,
  payments,
  ...(tellCustomer ? { tellCustomer } : {}),
});

/** A sender that records what it was asked to say and answers `sent-sent`. */
function spyTell(answer: string | null = "sent-sent") {
  const calls: { reservationId: unknown; by: unknown; refund: CancelNoticeRefund; actor: unknown }[] = [];
  const tell: TellCustomer = async (reservationId, by, refund, actor) => {
    calls.push({ reservationId, by, refund, actor });
    return answer;
  };
  return { tell, calls };
}

function channel(opts: { throws?: boolean } = {}): ChannelPort & { sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  return {
    sent,
    async send(msg: OutboundMessage) {
      if (opts.throws) throw new Error("medium rejected it");
      sent.push(msg);
      return { deliveredAt: NOW };
    },
  } as unknown as ChannelPort & { sent: OutboundMessage[] };
}

/** The real send, on fake channels — what a press reaches in production. */
function realSend(repo: InMemoryRepository, email = channel(), sms = channel()) {
  const tell: TellCustomer = (id, by, refund, actor) =>
    deliverCancelNotice(
      { repo, now: () => NOW, tenantName: "BrewBoat", linkBase: "https://muster.example", email, sms, live: true },
      id,
      by,
      refund,
      actor,
    );
  return { tell, email, sms };
}

const trail = (repo: InMemoryRepository) => repo.listTrailEventsFor(RESV, []);
const statusOf = async (repo: InMemoryRepository) => (await repo.getReservation(RESV))?.status;

const YOUR_TRIP = "Hi Rhea, your trip on Sat, Nov 28 at 3:30 PM is cancelled.";
const WE_CANCELLED = "Hi Rhea, we had to cancel your trip on Sat, Nov 28 at 3:30 PM. We're sorry.";
const PENDING = "We'll be in touch about your refund.";

const paragraphs = (message: OutboundMessage | undefined) => message!.body.split("\n\n");

describe("cancelByOperator — the press that cancels and refunds", () => {
  it("AC2: \"We cancelled\" with a blank box refunds everything paid and tells the customer", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    const { tell, email, sms } = realSend(repo);

    const result = await cancelByOperator(deps(repo, fake, tell), input({ by: "operator" }));

    expect(result).toEqual({
      params: { cancelled: "operator", refunded: String(PAID), told: "sent-sent" },
      draft: "clear",
    });
    expect(fake.refunds).toHaveLength(1);
    expect(fake.refunds[0]).toMatchObject({ paymentIntentId: "pi_full", amountCents: PAID });
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(1);
    expect(paragraphs(sms.sent[0]).slice(0, 2)).toEqual([
      WE_CANCELLED,
      "$644.00 is on its way back to your card. Refunds take a few days to show on a statement.",
    ]);
  });

  it("AC2: the notice comes after both the cancel and the refund", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    let seen: { status: unknown; refunds: number } | undefined;
    const tell: TellCustomer = async () => {
      seen = { status: await statusOf(repo), refunds: fake.refunds.length };
      return "sent-sent";
    };

    await cancelByOperator(deps(repo, fake, tell), input());

    expect(seen).toEqual({ status: "cancelled", refunds: 1 });
  });

  it("AC2: the move keeps the trail rows — the cancel, then the refund with its figure and the terms'", async () => {
    const repo = await seeded();

    await cancelByOperator(deps(repo), input({ typedAmount: "100", expectedRefunded: "0" }));

    const rows = await trail(repo);
    expect(rows.map((r) => r.type).sort()).toEqual(["cancelled", "refund_issued_by_operator"]);
    expect(rows.find((r) => r.type === "cancelled")).toMatchObject({
      actorKind: "admin",
      actorId: ADMIN,
      metadata: { reason: "cancelled by operator" },
    });
    expect(rows.find((r) => r.type === "refund_issued_by_operator")).toMatchObject({
      id: `refund_issued_by_operator:${RESV}:0`,
      actorKind: "admin",
      actorId: ADMIN,
      metadata: { actualCents: 10000, quotedCents: PAID, reason: "cancel-and-refund" },
    });
  });

  it("AC2: the crew's notices are relayed and the boat is freed", async () => {
    const repo = await seeded();
    const relayed: unknown[] = [];

    await cancelByOperator(
      {
        ...deps(repo),
        relayFormNotices: async (f) => {
          relayed.push(f);
        },
      },
      input(),
    );

    expect(relayed).toHaveLength(1);
    expect((await repo.getEvent(eventIdOf(FAR)))?.status).toBe("cancelled");
    expect(await repo.getReservation(RESV)).toMatchObject({ status: "cancelled", cancelledBy: "operator" });
  });

  it("AC3: \"The customer asked\" opens as AC1 does, and refunds the terms' figure", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    const { tell, sms } = realSend(repo);

    const result = await cancelByOperator(deps(repo, fake, tell), input({ by: "customer" }));

    expect(result).toEqual({
      params: { cancelled: "customer", refunded: String(CUSTOMER_REFUND), told: "sent-sent" },
      draft: "clear",
    });
    expect(paragraphs(sms.sent[0]).slice(0, 2)).toEqual([
      YOUR_TRIP,
      "$594.00 is on its way back to your card. Refunds take a few days to show on a statement.",
    ]);
  });

  it("AC3: the quote reads deps.now, not the wall clock — a departure long past is still 46 days out at that clock", async () => {
    const slot = { date: "2025-12-27", time: "15:30" };
    const repo = await seeded({ slot });
    const fake = new FakePaymentPort();

    const result = await cancelByOperator(
      { ...deps(repo, fake), now: () => "2025-11-11T16:00:00.000Z" },
      input({ by: "customer" }),
    );

    expect(result.params).toEqual({ cancelled: "customer", refunded: String(CUSTOMER_REFUND) });
    expect(fake.refunds[0]).toMatchObject({ amountCents: CUSTOMER_REFUND });
  });

  it("AC2: a typed figure overrides the terms, and the customer hears the figure that went", async () => {
    const repo = await seeded();
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input({ typedAmount: " $250.50 " }));

    expect(result.params).toEqual({ cancelled: "operator", refunded: "25050", told: "sent-sent" });
    expect(calls).toEqual([
      { reservationId: RESV, by: "operator", refund: { kind: "issued", cents: 25050 }, actor: { kind: "admin", id: ADMIN } },
    ]);
  });

  it("AC11: no sender wired — the press lands with no told on it", async () => {
    const repo = await seeded();

    const result = await cancelByOperator(deps(repo), input());

    expect(result).toEqual({ params: { cancelled: "operator", refunded: String(PAID) }, draft: "clear" });
  });

  it("AC11: told carries the send's code, unchanged", async () => {
    const repo = await seeded();
    const { tell } = realSend(repo, channel({ throws: true }), channel());

    const result = await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input());

    expect(result.params.told).toBe("failed-sent");
  });

  it("AC12: the press writes one notice row, the operator's", async () => {
    const repo = await seeded();
    const { tell } = realSend(repo);

    await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input());

    expect((await trail(repo)).filter((r) => r.type.startsWith("cancel_notice"))).toMatchObject([
      { type: "cancel_notice_sent", actorKind: "admin", actorId: ADMIN, metadata: { reason: "email=sent sms=sent" } },
    ]);
  });
});

describe("cancelByOperator — a refund that failed partway", () => {
  /** Fails every leg after the first. */
  function failsAfterFirstLeg(): FakePaymentPort {
    const fake = new FakePaymentPort();
    const real = fake.refund.bind(fake);
    let legs = 0;
    fake.refund = async (leg) => {
      if (legs++ > 0) throw new Error("card_declined");
      return real(leg);
    };
    return fake;
  }

  it("AC4: the figure is what the operator typed", async () => {
    const repo = await seeded({ payments: TWO_CHARGES });
    const { tell, sms } = realSend(repo);

    const result = await cancelByOperator(deps(repo, failsAfterFirstLeg(), tell), input({ typedAmount: "594" }));

    expect(result).toEqual({
      params: { cancelled: "operator", refundErr: "provider_error", refunded: "20000", told: "sent-sent" },
      draft: "clear",
    });
    expect(paragraphs(sms.sent[0])[1]).toBe(
      "$200.00 of your $594.00 refund is on its way back to your card. We'll be in touch about the rest.",
    );
  });

  it("AC4: the figure is the quote when the box was blank", async () => {
    const repo = await seeded({ payments: TWO_CHARGES });
    const { tell, calls } = spyTell();

    await cancelByOperator(deps(repo, failsAfterFirstLeg(), tell), input());

    expect(calls.map((c) => c.refund)).toEqual([{ kind: "partial", movedCents: 20000, cents: PAID }]);
  });

  it("AC4: what moved stays on the trail", async () => {
    const repo = await seeded({ payments: TWO_CHARGES });

    await cancelByOperator(deps(repo, failsAfterFirstLeg()), input());

    expect((await trail(repo)).filter((r) => r.type === "refund_failed")).toMatchObject([
      { actorKind: "admin", actorId: ADMIN, metadata: { actualCents: 20000, reason: "card_declined" } },
    ]);
  });
});

describe("cancelByOperator — cancelled, and no money moved when some was expected", () => {
  it("AC5: a typed amount that does not parse", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    const { tell, sms } = realSend(repo);

    const result = await cancelByOperator(deps(repo, fake, tell), input({ typedAmount: "50abc" }));

    expect(result).toEqual({
      params: { cancelled: "operator", refundErr: "invalid_amount", told: "sent-sent" },
      draft: "stash",
    });
    expect(fake.refunds).toEqual([]);
    expect(paragraphs(sms.sent[0])[1]).toBe(PENDING);
  });

  it("AC5: Stripe keys missing", async () => {
    const repo = await seeded();
    const { tell, calls } = spyTell();

    const result = await cancelByOperator({ repo, now: () => NOW, tellCustomer: tell }, input());

    expect(result).toEqual({
      params: { cancelled: "operator", refundErr: "stripe_not_configured", told: "sent-sent" },
      draft: "stash",
    });
    expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
  });

  it.each(["", "12.5", "abc"])("AC5: no usable expectedRefunded token (%j)", async (expectedRefunded) => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, fake, tell), input({ expectedRefunded }));

    expect(result).toEqual({
      params: { cancelled: "operator", refundErr: "stale", told: "sent-sent" },
      draft: "stash",
    });
    expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
    expect(fake.refunds).toEqual([]);
  });

  it("AC5: refundReservation throwing leaves the draft alone", async () => {
    const repo = await seeded();
    repo.acquireRefundLease = async () => {
      throw new Error("database unreachable");
    };
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input());

    expect(result).toEqual({
      params: { cancelled: "operator", refundErr: "unreachable", told: "sent-sent" },
      draft: "leave",
    });
    expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
  });

  it("AC5: a provider error with $0 moved — and a press that moved nothing writes its refund_failed row", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    fake.refundError = new Error("card_declined");
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, fake, tell), input());

    expect(result).toEqual({
      params: { cancelled: "operator", refundErr: "provider_error", refunded: "0", told: "sent-sent" },
      draft: "clear",
    });
    expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
    expect((await trail(repo)).filter((r) => r.type === "refund_failed")).toMatchObject([
      { actorKind: "admin", actorId: ADMIN, metadata: { actualCents: 0, reason: "card_declined" } },
    ]);
  });

  it("AC5: any other refusal from refundReservation keeps the figure as a draft", async () => {
    const { stripePaymentIntentId: _pi, ...noIntent } = payment();
    const repo = await seeded({ payments: [noIntent] });
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input());

    expect(result).toEqual({
      params: { cancelled: "operator", refundErr: "no_payment_intent", told: "sent-sent" },
      draft: "stash",
    });
    expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
  });

  it("AC5: a stale token from the form is a refusal too", async () => {
    const repo = await seeded();
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input({ expectedRefunded: "500" }));

    expect(result).toEqual({
      params: { cancelled: "operator", refundErr: "stale", told: "sent-sent" },
      draft: "stash",
    });
    expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
  });

  it("AC5: no published-terms figure because another booking still holds the event", async () => {
    const repo = await seeded();
    await repo.saveReservation(reservation(FAR, { id: asId<"ReservationId">("resv-other"), customerName: "Ben" }));
    const fake = new FakePaymentPort();
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, fake, tell), input());

    expect(result).toEqual({ params: { cancelled: "operator", told: "sent-sent" }, draft: "clear" });
    expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
    expect(fake.refunds).toEqual([]);
  });

  it("AC5: no published-terms figure because the reads threw — the press still lands", async () => {
    const repo = await seeded();
    repo.listPaymentsForReservation = async () => {
      throw new Error("database unreachable");
    };
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input());

    expect(result).toEqual({ params: { cancelled: "operator", told: "sent-sent" }, draft: "clear" });
    expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
  });

  it("AC5: the operator typed $0 while the terms owe more", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    const { tell, sms } = realSend(repo);

    const result = await cancelByOperator(deps(repo, fake, tell), input({ typedAmount: "0" }));

    expect(result).toEqual({ params: { cancelled: "operator", told: "sent-sent" }, draft: "clear" });
    expect(fake.refunds).toEqual([]);
    expect(paragraphs(sms.sent[0])[1]).toBe(PENDING);
  });

  describe("AC5: a typed figure on a booking whose terms owe $0 is pending at every exit, never none_due", () => {
    const { stripePaymentIntentId: _pi, ...noIntent } = payment();

    it.each<[string, { typedAmount?: string; expectedRefunded?: string; noStripe?: true; payments?: Payment[] }]>([
      ["it does not parse", { typedAmount: "50abc" }],
      ["Stripe keys are missing", { noStripe: true }],
      ["there is no token", { expectedRefunded: "" }],
      ["refundReservation refuses it", { payments: [noIntent] }],
      ["it is more than the booking can give back", { typedAmount: "99999" }],
    ])("AC5: when %s", async (_label, o) => {
      const repo = await seeded({ slot: NEAR, payments: o.payments ?? [payment()] });
      const { tell, calls } = spyTell();
      const wired = { repo, now: () => NOW, tellCustomer: tell, ...(o.noStripe ? {} : { payments: new FakePaymentPort() }) };

      await cancelByOperator(
        wired,
        input({ by: "customer", typedAmount: o.typedAmount ?? "100", expectedRefunded: o.expectedRefunded ?? "0" }),
      );

      expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
    });

    it("AC5: when refundReservation throws", async () => {
      const repo = await seeded({ slot: NEAR });
      repo.acquireRefundLease = async () => {
        throw new Error("database unreachable");
      };
      const { tell, calls } = spyTell();

      await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input({ by: "customer", typedAmount: "100" }));

      expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
    });

    it("AC5: when the provider moved nothing", async () => {
      const repo = await seeded({ slot: NEAR });
      const fake = new FakePaymentPort();
      fake.refundError = new Error("card_declined");
      const { tell, calls } = spyTell();

      await cancelByOperator(deps(repo, fake, tell), input({ by: "customer", typedAmount: "100" }));

      expect(calls.map((c) => c.refund)).toEqual([{ kind: "pending" }]);
    });
  });
});

describe("cancelByOperator — no refund owed", () => {
  it("AC6: \"The customer asked\", the terms owe $0 and the customer has paid", async () => {
    const repo = await seeded({ slot: NEAR });
    const fake = new FakePaymentPort();
    const { tell, sms } = realSend(repo);

    const result = await cancelByOperator(deps(repo, fake, tell), input({ by: "customer" }));

    expect(result).toEqual({ params: { cancelled: "customer", told: "sent-sent" }, draft: "clear" });
    expect(fake.refunds).toEqual([]);
    expect(paragraphs(sms.sent[0])[1]).toBe("No refund is due under your booking's cancellation terms.");
  });

  it("AC6: typing $0 where the terms owe $0 reads the same", async () => {
    const repo = await seeded({ slot: NEAR });
    const { tell, calls } = spyTell();

    await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input({ by: "customer", typedAmount: "0" }));

    expect(calls.map((c) => c.refund)).toEqual([{ kind: "none_due" }]);
  });

  it("AC7: a $0 comp has no refund line", async () => {
    const repo = await seeded({ payments: [] });
    const { tell, sms } = realSend(repo);

    const result = await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input());

    expect(result).toEqual({ params: { cancelled: "operator", told: "sent-sent" }, draft: "clear" });
    expect(paragraphs(sms.sent[0])).toHaveLength(3);
    expect(paragraphs(sms.sent[0])[1]).toMatch(/^Your booking: /);
  });

  it("AC7: already refunded in full has no refund line", async () => {
    const repo = await seeded({ payments: [payment({ status: "refunded", refundedCents: PAID })] });
    const { tell, calls } = spyTell();

    await cancelByOperator(
      deps(repo, new FakePaymentPort(), tell),
      input({ by: "customer", expectedRefunded: String(PAID) }),
    );

    expect(calls.map((c) => c.refund)).toEqual([{ kind: "nothing_paid" }]);
  });
});

describe("cancelByOperator — one notice per cancel, from the press that cancelled", () => {
  it("AC8: none from a press refused before anything was cancelled", async () => {
    const repo = await seeded({ reservation: { source: "xola" } });
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input());

    expect(result).toEqual({ params: { cancelErr: "not_muster" }, draft: "stash" });
    expect(calls).toEqual([]);
    expect(await trail(repo)).toEqual([]);
  });

  it("AC8: none for a reservation that does not exist", async () => {
    const repo = new InMemoryRepository();
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input());

    expect(result).toEqual({ params: { cancelErr: "reservation_missing" }, draft: "stash" });
    expect(calls).toEqual([]);
  });

  it("issue #1228 AC8: the write throwing is a failed press — unreachable with the draft stashed, no refund, no trail row, no notice", async () => {
    const repo = await seeded();
    repo.cancelBookingAndRelease = async () => {
      throw new Error("database unreachable");
    };
    const fake = new FakePaymentPort();
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, fake, tell), input());

    expect(result).toEqual({ params: { cancelErr: "unreachable" }, draft: "stash" });
    expect(fake.refunds).toEqual([]);
    expect((await trail(repo)).filter((r) => r.type === "cancelled")).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("issue #1228 AC11: a booking already cancelled redirects with alreadyCancelled — no notice, no refund, no trail row", async () => {
    const repo = await seeded({ reservation: { status: "cancelled", cancelledBy: "customer" } });
    const fake = new FakePaymentPort();
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, fake, tell), input());

    expect(result).toEqual({ params: { alreadyCancelled: "1" }, draft: "clear" });
    expect(calls).toEqual([]);
    expect(fake.refunds).toEqual([]);
    expect(await trail(repo)).toEqual([]);
  });

  it("issue #1228 AC11: the loser of two presses redirects the same way", async () => {
    const repo = await seeded();
    repo.cancelBookingAndRelease = async () => ({ cancelled: false, released: false });
    const { tell, calls } = spyTell();

    const result = await cancelByOperator(deps(repo, new FakePaymentPort(), tell), input());

    expect(result).toEqual({ params: { alreadyCancelled: "1" }, draft: "clear" });
    expect(calls).toEqual([]);
  });

  it("AC8: two presses at once send one notice and refund once", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    const { tell, calls } = spyTell();

    const results = await Promise.all([
      cancelByOperator(deps(repo, fake, tell), input()),
      cancelByOperator(deps(repo, fake, tell), input()),
    ]);

    expect(calls).toHaveLength(1);
    expect(fake.refunds).toHaveLength(1);
    expect(results.filter((r) => r.params.told === "sent-sent")).toHaveLength(1);
    expect(results.filter((r) => "alreadyCancelled" in r.params)).toHaveLength(1);
  });
});

describe("cancelByOperator — a failed notice never touches the cancel or the refund", () => {
  const expectStood = async (repo: InMemoryRepository, fake: FakePaymentPort) => {
    expect(await statusOf(repo)).toBe("cancelled");
    expect(fake.refunds).toHaveLength(1);
    expect((await repo.getPayment(asId<"PaymentId">("pay-full")))?.refundedCents).toBe(PAID);
  };

  it("AC10: the sender rejecting reads error, and the press lands where it would have", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    const tell: TellCustomer = async () => {
      throw new Error("sender blew up");
    };

    const result = await cancelByOperator(deps(repo, fake, tell), input());

    expect(result).toEqual({
      params: { cancelled: "operator", refunded: String(PAID), told: "error" },
      draft: "clear",
    });
    await expectStood(repo, fake);
  });

  it("AC10: a channel throwing reads failed on that channel", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    const { tell } = realSend(repo, channel({ throws: true }), channel({ throws: true }));

    const result = await cancelByOperator(deps(repo, fake, tell), input());

    expect(result.params).toEqual({ cancelled: "operator", refunded: String(PAID), told: "failed-failed" });
    await expectStood(repo, fake);
    expect((await trail(repo)).filter((r) => r.type.startsWith("cancel_notice"))).toMatchObject([
      { type: "cancel_notice_failed", metadata: { reason: "email=failed sms=failed" } },
    ]);
  });

  it("AC10: the booking-code lookup throwing reads error, with a cancel_notice_failed row", async () => {
    const repo = await seeded();
    const fake = new FakePaymentPort();
    repo.listBookingCodesForReservation = async () => {
      throw new Error("database unreachable");
    };
    const { tell } = realSend(repo);

    const result = await cancelByOperator(deps(repo, fake, tell), input());

    expect(result.params).toEqual({ cancelled: "operator", refunded: String(PAID), told: "error" });
    await expectStood(repo, fake);
    expect((await trail(repo)).filter((r) => r.type.startsWith("cancel_notice"))).toMatchObject([
      { type: "cancel_notice_failed", metadata: { reason: "error" } },
    ]);
  });
});

describe("cancelByOperator — an unpaid phone booking", () => {
  it("AC13: a stale post that delegates to cancelUnpaidPhoneBooking sends nothing and carries no told", async () => {
    const repo = await seeded({
      noEvent: true,
      payments: [],
      reservation: { source: "admin", status: "pending", eventId: null, paymentIntentIds: ["pi_open"] },
    });
    const fake = new FakePaymentPort();
    const { tell, email, sms } = realSend(repo);

    const result = await cancelByOperator(deps(repo, fake, tell), input());

    expect(result).toEqual({ params: { cancelled: "operator" }, draft: "clear" });
    expect(await statusOf(repo)).toBe("cancelled");
    expect(fake.cancelled.map((c) => c.paymentIntentId)).toEqual(["pi_open"]);
    expect(email.sent).toEqual([]);
    expect(sms.sent).toEqual([]);
    expect((await trail(repo)).filter((r) => r.type.startsWith("cancel_notice"))).toEqual([]);
  });
});
