/**
 * Telling the customer their booking was cancelled (issue #1212): the one body, sent unchanged on
 * both channels, and the trail row that says whether it reached them.
 *
 * Body wording here is literal rather than built from the helpers it uses: a customer reads these
 * sentences, and the point is to catch them changing.
 */
import { describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { CancelledBy, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { ChannelPort, OutboundMessage } from "../ports/channel.js";
import { bookingUrl } from "./booking-code.js";
import type { CancelQuote } from "./cancel-reservation.js";
import {
  cancelNoticeBody,
  cancelNoticeReached,
  deliverCancelNotice,
  noRefundSentNotice,
  noticeRefundOf,
  recordCancelNotice,
  refundOnItsWay,
  sendCancelNotice,
  tellSafely,
  type CancelNoticeDeps,
  type CancelNoticeRefund,
  type TellCustomer,
} from "./cancel-notice.js";
import { nonGsm7Chars } from "./sms-alphabet.js";

const RESV = asId<"ReservationId">("resv-cancel-1");
const NOW = "2026-11-01T16:00:00.000Z";
const LINK_BASE = "https://muster.example";
const CODE = "K3F9QZ2MX7RN4P";
const URL = `${LINK_BASE}/b/${CODE}`;
const ADMIN = { kind: "admin", id: "crew-admin-1" } as const;
const CUSTOMER = { kind: "customer" } as const;

const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: RESV,
  eventId: asId<"EventId">("evt-1"),
  source: "muster",
  customerName: "Rhea Tallis",
  partySize: 6,
  status: "cancelled",
  cancelledBy: "customer",
  email: "rhea@example.com",
  phone: "+12165550199",
  date: "2026-11-28",
  time: "15:30",
  ...over,
});

function channel(opts: { throws?: string; logs?: boolean } = {}): ChannelPort & { sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  return {
    sent,
    async send(msg: OutboundMessage) {
      if (opts.throws) throw new Error(opts.throws);
      sent.push(msg);
      return opts.logs
        ? { deliveredAt: NOW, ref: "logged", loggedOnly: true }
        : { deliveredAt: NOW };
    },
  } as unknown as ChannelPort & { sent: OutboundMessage[] };
}

const body = (refund: CancelNoticeRefund, by: CancelledBy = "customer", over: Partial<Reservation> = {}): string =>
  cancelNoticeBody({ reservation: reservation(over), by, refund, manageUrl: URL, tenantName: "BrewBoat" });

const lines = (...paragraphs: string[]): string => paragraphs.join("\n\n");

const YOUR_TRIP = "Hi Rhea, your trip on Sat, Nov 28 at 3:30 PM is cancelled.";
const WE_CANCELLED = "Hi Rhea, we had to cancel your trip on Sat, Nov 28 at 3:30 PM. We're sorry.";
const FOOT = [`Your booking: ${URL}`, "- BrewBoat"];

describe("cancelNoticeBody", () => {
  it("AC1: the customer's cancel with the refund through — the whole message, as it goes out", () => {
    expect(body({ kind: "issued", cents: 59400 })).toBe(
      lines(
        YOUR_TRIP,
        "$594.00 is on its way back to your card. Refunds take a few days to show on a statement.",
        ...FOOT,
      ),
    );
  });

  it("AC2: the operator's cancel opens with the apology", () => {
    expect(body({ kind: "issued", cents: 64400 }, "operator")).toBe(
      lines(
        WE_CANCELLED,
        "$644.00 is on its way back to your card. Refunds take a few days to show on a statement.",
        ...FOOT,
      ),
    );
  });

  it("AC3: by customer, whoever pressed, the opening is AC1's", () => {
    expect(body({ kind: "pending" }, "customer").split("\n\n")[0]).toBe(YOUR_TRIP);
  });

  it("AC4: a refund that failed partway says what moved, out of what was tried", () => {
    expect(body({ kind: "partial", movedCents: 20000, cents: 59400 })).toBe(
      lines(
        YOUR_TRIP,
        "$200.00 of your $594.00 refund is on its way back to your card. We'll be in touch about the rest.",
        ...FOOT,
      ),
    );
  });

  it("AC5: no money moved when some was expected", () => {
    expect(body({ kind: "pending" }, "operator")).toBe(
      lines(WE_CANCELLED, "We'll be in touch about your refund.", ...FOOT),
    );
  });

  it("AC6: the terms owe nothing and the customer has paid", () => {
    expect(body({ kind: "none_due" })).toBe(
      lines(YOUR_TRIP, "No refund is due under your booking's cancellation terms.", ...FOOT),
    );
  });

  it("AC7: nothing refundable — no refund line, and no gap where it would be", () => {
    expect(body({ kind: "nothing_paid" })).toBe(lines(YOUR_TRIP, ...FOOT));
  });

  it("AC1: a row with no departure on it drops <when>, and no name reads as there", () => {
    expect(body({ kind: "nothing_paid" }, "customer", { customerName: "", date: undefined as never })).toBe(
      lines("Hi there, your trip is cancelled.", ...FOOT),
    );
  });

  const every: [CancelledBy, CancelNoticeRefund][] = (["customer", "operator"] as const).flatMap((by) =>
    (
      [
        { kind: "issued", cents: 123456 },
        { kind: "partial", movedCents: 20000, cents: 59400 },
        { kind: "pending" },
        { kind: "none_due" },
        { kind: "nothing_paid" },
      ] as const
    ).map((refund): [CancelledBy, CancelNoticeRefund] => [by, refund]),
  );

  it.each(every)("AC14: stays in GSM-7 — by %s, %o", (by, refund) => {
    // The stray in the name proves the check read a real body, and that only the name is excused.
    const text = body(refund, by, { customerName: "Zoë Tallis" });
    expect(nonGsm7Chars(text)).toEqual(["ë"]);
    expect(nonGsm7Chars(text, ["Zoë"])).toEqual([]);
  });
});

describe("refundOnItsWay", () => {
  it("AC1: the shared sentence, with the amount formatted", () => {
    expect(refundOnItsWay(59400)).toBe("$594.00 is on its way back to your card.");
    expect(refundOnItsWay(123456)).toBe("$1,234.56 is on its way back to your card.");
  });
});

describe("noticeRefundOf — the customer path", () => {
  it("AC1: issued stays issued", () => {
    expect(noticeRefundOf({ kind: "issued", cents: 59400 })).toEqual({ kind: "issued", cents: 59400 });
  });

  it("AC4: failed with money moved is partial, at the figure tried", () => {
    expect(noticeRefundOf({ kind: "failed", cents: 59400, movedCents: 20000 })).toEqual({
      kind: "partial",
      movedCents: 20000,
      cents: 59400,
    });
  });

  it("AC5: failed with nothing moved is pending", () => {
    expect(noticeRefundOf({ kind: "failed", cents: 59400, movedCents: 0 })).toEqual({ kind: "pending" });
  });
});

describe("noRefundSentNotice — the press that sent no refund", () => {
  const quote = (paidCents: number, refundCents: number): CancelQuote => ({
    by: "customer",
    paidCents,
    hoursBeforeDeparture: 120,
    refundCents,
  });

  it("AC5: no quote could be computed", () => {
    expect(noRefundSentNotice(null)).toEqual({ kind: "pending" });
  });

  it("AC5: the terms owe more than $0 and the operator typed $0", () => {
    expect(noRefundSentNotice(quote(64400, 59400))).toEqual({ kind: "pending" });
  });

  it("AC6: the customer has paid and the terms owe $0", () => {
    expect(noRefundSentNotice(quote(64400, 0))).toEqual({ kind: "none_due" });
  });

  it("AC7: nothing left to refund, whatever the terms say", () => {
    expect(noRefundSentNotice(quote(0, 0))).toEqual({ kind: "nothing_paid" });
  });
});

describe("cancelNoticeReached", () => {
  it("AC12: true when either half of <email>-<sms> reads sent, and for nothing else", () => {
    const codes = [
      "sent-sent",
      "sent-failed",
      "failed-sent",
      "absent-sent",
      "sent-logged",
      "failed-failed",
      "logged-logged",
      "absent-logged",
      "absent-absent",
      "skipped",
      "error",
    ];
    expect(codes.filter(cancelNoticeReached)).toEqual([
      "sent-sent",
      "sent-failed",
      "failed-sent",
      "absent-sent",
      "sent-logged",
    ]);
  });
});

describe("sendCancelNotice", () => {
  const send = (
    deps: { email?: ChannelPort; sms?: ChannelPort; onFailure?: (d: string) => void },
    over: Partial<Reservation> = {},
  ) =>
    sendCancelNotice(
      { tenantName: "BrewBoat", linkBase: LINK_BASE, ...deps },
      { reservation: reservation(over), by: "customer", refund: { kind: "issued", cents: 59400 } },
      CODE,
    );

  it("AC1: one email and one text, the same body on each", async () => {
    const email = channel();
    const sms = channel();

    expect(await send({ email, sms })).toEqual({ email: "sent", sms: "sent" });

    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: { email: "rhea@example.com" } });
    expect(sms.sent[0]).toMatchObject({ to: { phone: "+12165550199" } });
    expect(sms.sent[0]!.body).toBe(
      lines(
        YOUR_TRIP,
        "$594.00 is on its way back to your card. Refunds take a few days to show on a statement.",
        ...FOOT,
      ),
    );
    expect(email.sent[0]!.body).toBe(sms.sent[0]!.body);
  });

  it("AC15: the link is the booking's own code on the link base", async () => {
    const sms = channel();
    await sendCancelNotice(
      { tenantName: "BrewBoat", linkBase: `${LINK_BASE}/`, sms },
      { reservation: reservation(), by: "customer", refund: { kind: "pending" } },
      "OTHERCODE234567",
    );
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.body).toContain(`Your booking: ${bookingUrl(LINK_BASE, "OTHERCODE234567")}\n`);
  });

  it("AC9: no email on the booking — the text still goes", async () => {
    const email = channel();
    const sms = channel();
    const { email: _none, ...phoneOnly } = reservation();

    const result = await sendCancelNotice(
      { tenantName: "BrewBoat", linkBase: LINK_BASE, email, sms },
      { reservation: phoneOnly, by: "customer", refund: { kind: "pending" } },
      CODE,
    );

    expect(result).toEqual({ email: "absent", sms: "sent" });
    expect(email.sent).toEqual([]);
    expect(sms.sent).toHaveLength(1);
  });

  it("AC9: no phone on the booking — the email still goes", async () => {
    const email = channel();
    const sms = channel();
    const { phone: _none, ...emailOnly } = reservation();

    const result = await sendCancelNotice(
      { tenantName: "BrewBoat", linkBase: LINK_BASE, email, sms },
      { reservation: emailOnly, by: "customer", refund: { kind: "pending" } },
      CODE,
    );

    expect(result).toEqual({ email: "sent", sms: "absent" });
    expect(sms.sent).toEqual([]);
    expect(email.sent).toHaveLength(1);
  });

  it("AC9: only one channel configured — that one is sent", async () => {
    const sms = channel();
    expect(await send({ sms })).toEqual({ email: "absent", sms: "sent" });
    expect(sms.sent).toHaveLength(1);

    const email = channel();
    expect(await send({ email })).toEqual({ email: "sent", sms: "absent" });
    expect(email.sent).toHaveLength(1);
  });

  it("AC10: a channel that throws reads failed, and the other still goes", async () => {
    const failures: string[] = [];
    const sms = channel();

    const result = await send({
      email: channel({ throws: "medium rejected it" }),
      sms,
      onFailure: (d) => failures.push(d),
    });

    expect(result).toEqual({ email: "failed", sms: "sent" });
    expect(sms.sent).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });

  it("AC10: the text throwing leaves the email sent", async () => {
    const email = channel();
    expect(await send({ email, sms: channel({ throws: "carrier refused" }) })).toEqual({ email: "sent", sms: "failed" });
    expect(email.sent).toHaveLength(1);
  });

  it("AC9: a channel that only logs reads logged, never sent", async () => {
    expect(await send({ email: channel(), sms: channel({ logs: true }) })).toEqual({ email: "sent", sms: "logged" });
  });
});

describe("deliverCancelNotice", () => {
  async function seeded(over: Partial<Reservation> = {}): Promise<InMemoryRepository> {
    const repo = new InMemoryRepository();
    await repo.saveReservation(reservation(over));
    return repo;
  }

  const deps = (repo: InMemoryRepository, over: Partial<CancelNoticeDeps> = {}): CancelNoticeDeps => ({
    repo,
    now: () => NOW,
    tenantName: "BrewBoat",
    linkBase: LINK_BASE,
    email: channel(),
    sms: channel(),
    live: true,
    ...over,
  });

  const rows = (repo: InMemoryRepository) => repo.listTrailEventsFor(RESV, []);
  const PENDING: CancelNoticeRefund = { kind: "pending" };

  it("AC1: sends both channels and returns <email>-<sms>", async () => {
    const repo = await seeded();
    const email = channel();
    const sms = channel();

    expect(await deliverCancelNotice(deps(repo, { email, sms }), RESV, "operator", PENDING, ADMIN)).toBe("sent-sent");

    expect(email.sent).toHaveLength(1);
    expect(sms.sent[0]!.body.split("\n\n")[0]).toBe(WE_CANCELLED);
  });

  it("AC12: both sent — one cancel_notice_sent row, the operator's", async () => {
    const repo = await seeded();

    await deliverCancelNotice(deps(repo), RESV, "operator", PENDING, ADMIN);

    expect(await rows(repo)).toMatchObject([
      {
        reservationId: RESV,
        type: "cancel_notice_sent",
        actorKind: "admin",
        actorId: "crew-admin-1",
        timestamp: NOW,
        metadata: { reason: "email=sent sms=sent" },
      },
    ]);
  });

  it("AC12: the customer's own cancel is the customer's row, with no actor id", async () => {
    const repo = await seeded();

    await deliverCancelNotice(deps(repo), RESV, "customer", PENDING, CUSTOMER);

    const written = await rows(repo);
    expect(written).toMatchObject([{ type: "cancel_notice_sent", actorKind: "customer" }]);
    expect(written[0]!.actorId).toBeUndefined();
  });

  it("AC12: one of two sent is still cancel_notice_sent, and the reason names both", async () => {
    const repo = await seeded();

    expect(
      await deliverCancelNotice(deps(repo, { sms: channel({ throws: "carrier refused" }) }), RESV, "operator", PENDING, ADMIN),
    ).toBe("sent-failed");

    expect(await rows(repo)).toMatchObject([
      { type: "cancel_notice_sent", metadata: { reason: "email=sent sms=failed" } },
    ]);
  });

  it("AC12: none sent is cancel_notice_failed", async () => {
    const repo = await seeded();

    expect(
      await deliverCancelNotice(
        deps(repo, { email: channel({ throws: "x" }), sms: channel({ logs: true }) }),
        RESV,
        "operator",
        PENDING,
        ADMIN,
      ),
    ).toBe("failed-logged");

    expect(await rows(repo)).toMatchObject([
      { type: "cancel_notice_failed", metadata: { reason: "email=failed sms=logged" } },
    ]);
  });

  it("AC12: the row holds neither the link nor the provider's message", async () => {
    const repo = await seeded();
    const message = `550 rhea@example.com rejected ${URL}`;

    await deliverCancelNotice(deps(repo, { email: channel({ throws: message }) }), RESV, "operator", PENDING, ADMIN);

    const written = await rows(repo);
    expect(written).toHaveLength(1);
    expect(written[0]!.metadata).toEqual({ reason: "email=failed sms=sent" });
  });

  it("AC12: no email channel and no live text is skipped, and the send still runs so the body reaches the log", async () => {
    const repo = await seeded();
    const sms = channel({ logs: true });
    const { email: _none, ...noEmail } = deps(repo, { sms, live: false });

    expect(await deliverCancelNotice(noEmail, RESV, "operator", PENDING, ADMIN)).toBe("skipped");

    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.body).toContain("We'll be in touch about your refund.");
    expect(await rows(repo)).toMatchObject([{ type: "cancel_notice_failed", metadata: { reason: "skipped" } }]);
  });

  it("AC12: an email channel with no live text is not skipped", async () => {
    const repo = await seeded();

    expect(await deliverCancelNotice(deps(repo, { sms: channel({ logs: true }), live: false }), RESV, "operator", PENDING, ADMIN)).toBe(
      "sent-logged",
    );
  });

  it("AC9: only a phone on file, and it reaches them", async () => {
    const { email: _none, ...phoneOnly } = reservation();
    const repo = new InMemoryRepository();
    await repo.saveReservation(phoneOnly);
    const email = channel();

    expect(await deliverCancelNotice(deps(repo, { email }), RESV, "operator", PENDING, ADMIN)).toBe("absent-sent");

    expect(email.sent).toEqual([]);
    expect(await rows(repo)).toMatchObject([{ type: "cancel_notice_sent", metadata: { reason: "email=absent sms=sent" } }]);
  });

  it.each<[string, Partial<Reservation>]>([
    ["an unpaid phone booking", { source: "admin", status: "cancelled", eventId: null }],
    ["a Xola booking", { source: "xola" }],
  ])("AC13: %s gets no notice — null, no row, nothing sent, no code minted", async (_label, over) => {
    const repo = await seeded(over);
    const email = channel();
    const sms = channel();

    expect(await deliverCancelNotice(deps(repo, { email, sms }), RESV, "operator", PENDING, ADMIN)).toBeNull();

    expect(email.sent).toEqual([]);
    expect(sms.sent).toEqual([]);
    expect(await rows(repo)).toEqual([]);
    expect(await repo.listBookingCodesForReservation(RESV)).toEqual([]);
  });

  it("AC13: a row that no longer exists gets no notice", async () => {
    const repo = new InMemoryRepository();
    const sms = channel();

    expect(await deliverCancelNotice(deps(repo, { sms }), RESV, "operator", PENDING, ADMIN)).toBeNull();

    expect(sms.sent).toEqual([]);
    expect(await rows(repo)).toEqual([]);
  });

  it("AC15: a booking with a live code keeps it, and no second one is minted", async () => {
    const repo = await seeded();
    await repo.saveBookingCode({ code: CODE, reservationId: RESV, createdAt: "2026-10-01T10:00:00.000Z" });
    const sms = channel();

    await deliverCancelNotice(deps(repo, { sms }), RESV, "operator", PENDING, ADMIN);

    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.body).toContain(`Your booking: ${bookingUrl(LINK_BASE, CODE)}\n`);
    expect((await repo.listBookingCodesForReservation(RESV)).map((c) => c.code)).toEqual([CODE]);
  });

  it("AC15: a booking with no live code gets one, and that one is the link", async () => {
    const repo = await seeded();
    const sms = channel();

    await deliverCancelNotice(deps(repo, { sms }), RESV, "operator", PENDING, ADMIN);

    const codes = await repo.listBookingCodesForReservation(RESV);
    expect(codes).toHaveLength(1);
    expect(sms.sent[0]!.body).toContain(`Your booking: ${bookingUrl(LINK_BASE, codes[0]!.code)}\n`);
  });

  it("AC10: the booking-code lookup throwing reads error, with a cancel_notice_failed row", async () => {
    const repo = await seeded();
    repo.listBookingCodesForReservation = async () => {
      throw new Error("database unreachable");
    };
    const sms = channel();

    expect(await deliverCancelNotice(deps(repo, { sms }), RESV, "operator", PENDING, ADMIN)).toBe("error");

    expect(sms.sent).toEqual([]);
    expect(await rows(repo)).toMatchObject([{ type: "cancel_notice_failed", metadata: { reason: "error" } }]);
  });

  it("AC10: reading the row throwing reads error, with a row while the repository still answers", async () => {
    const repo = await seeded();
    repo.getReservation = async () => {
      throw new Error("database unreachable");
    };

    expect(await deliverCancelNotice(deps(repo), RESV, "operator", PENDING, ADMIN)).toBe("error");

    expect(await rows(repo)).toMatchObject([{ type: "cancel_notice_failed", metadata: { reason: "error" } }]);
  });

  it("AC10: never throws, even with the repository gone altogether", async () => {
    const repo = await seeded();
    repo.getReservation = async () => {
      throw new Error("database unreachable");
    };
    repo.appendTrailEvent = async () => {
      throw new Error("database unreachable");
    };

    await expect(deliverCancelNotice(deps(repo), RESV, "operator", PENDING, ADMIN)).resolves.toBe("error");
  });

  it("AC10: a trail write that fails after the send leaves the channels' answer standing", async () => {
    const repo = await seeded();
    repo.appendTrailEvent = async () => {
      throw new Error("database unreachable");
    };

    await expect(deliverCancelNotice(deps(repo), RESV, "operator", PENDING, ADMIN)).resolves.toBe("sent-sent");
  });
});

describe("recordCancelNotice", () => {
  const trailDeps = (repo: InMemoryRepository) => ({ repo, now: () => NOW });

  it.each([
    ["sent-sent", "cancel_notice_sent", "email=sent sms=sent"],
    ["absent-sent", "cancel_notice_sent", "email=absent sms=sent"],
    ["sent-logged", "cancel_notice_sent", "email=sent sms=logged"],
    ["failed-failed", "cancel_notice_failed", "email=failed sms=failed"],
    ["logged-absent", "cancel_notice_failed", "email=logged sms=absent"],
    ["absent-absent", "cancel_notice_failed", "email=absent sms=absent"],
    ["skipped", "cancel_notice_failed", "skipped"],
    ["error", "cancel_notice_failed", "error"],
  ])("AC12: %s writes %s with reason %s", async (code, type, reason) => {
    const repo = new InMemoryRepository();

    await recordCancelNotice(trailDeps(repo), RESV, code, ADMIN);

    expect(await repo.listTrailEventsFor(RESV, [])).toMatchObject([
      { reservationId: RESV, type, actorKind: "admin", actorId: "crew-admin-1", timestamp: NOW, metadata: { reason } },
    ]);
  });
});

describe("tellSafely", () => {
  it("AC11: hands the call through and returns the code", async () => {
    const calls: unknown[][] = [];
    const tell: TellCustomer = async (...args) => {
      calls.push(args);
      return "sent-failed";
    };

    expect(await tellSafely(tell, RESV, "operator", { kind: "pending" }, ADMIN)).toBe("sent-failed");

    expect(calls).toEqual([[RESV, "operator", { kind: "pending" }, ADMIN]]);
  });

  it("AC13: a null from the send stays null", async () => {
    let called = 0;
    const tell: TellCustomer = async () => {
      called++;
      return null;
    };

    expect(await tellSafely(tell, RESV, "operator", { kind: "pending" }, ADMIN)).toBeNull();

    expect(called).toBe(1);
  });

  it("AC10: no sender is null", async () => {
    expect(await tellSafely(undefined, RESV, "customer", { kind: "pending" }, CUSTOMER)).toBeNull();
  });

  it("AC10: a rejection reads error, and is logged rather than dropped", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const tell: TellCustomer = async () => {
        throw new Error("sender blew up");
      };

      await expect(tellSafely(tell, RESV, "customer", { kind: "pending" }, CUSTOMER)).resolves.toBe("error");

      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]!.some((a) => a instanceof Error && a.message === "sender blew up")).toBe(true);
    } finally {
      logged.mockRestore();
    }
  });
});
