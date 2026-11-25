/**
 * The failed balance charge's two messages and its trail row (issue #1273). The job that sends them is
 * `balance-charge.test.ts`'s.
 *
 * The bodies are checked by the values they carry, never by a sentence: the wording is the operator's
 * and may change without a test changing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeChannel } from "../adapters/fake-channel.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { OutboundMessage, SendResult } from "../ports/channel.js";
import {
  balanceAdminAlertBody,
  balanceFailedBody,
  deliverBalanceNotice,
  recordBalanceFailed,
  type BalanceFailure,
  type BalanceNoticeDeps,
} from "./balance-notice.js";
import { bookingUrl } from "./booking-code.js";
import { declineReasonOf } from "./purchases-view.js";
import { tripDayTime } from "./send-payment-link.js";
import { nonGsm7Chars } from "./sms-alphabet.js";

const RES = asId<"ReservationId">("resv-bal-notice");
const NOW = "2026-11-14T14:00:00.000Z";
const LINK_BASE = "https://muster.example";
const CODE = "K3F9QZ2MX7RN4P";
const URL = bookingUrl(LINK_BASE, CODE);
const WHEN = "Sat, Nov 28 at 3:30 PM";
/** 9 AM on Tue, Dec 1 where the boats are. */
const NEXT = "2026-12-01T14:00:00.000Z";

type Declined = Extract<BalanceFailure, { outcome: "declined" }>;

const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: RES,
  eventId: asId<"EventId">("evt-1"),
  source: "muster",
  customerName: "Dana Whitcomb",
  partySize: 6,
  status: "booked",
  email: "dana@example.com",
  phone: "+12165550148",
  date: "2026-11-28",
  time: "15:30",
  ...over,
});

/** A decline on the due date, with a retry still to come and no code from the bank. */
const declinedNoCode = (over: Partial<Declined> = {}): Declined => ({
  attempt: 0,
  owedCents: 55294,
  nextAttemptAt: NEXT,
  outcome: "declined",
  ...over,
});
const declined = (over: Partial<Declined> = {}): Declined => declinedNoCode({ declineCode: "insufficient_funds", ...over });

const NEEDS_APPROVAL: BalanceFailure = {
  attempt: 0,
  owedCents: 55294,
  nextAttemptAt: null,
  outcome: "needs_approval",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tripDayTime", () => {
  it("AC4: the trip's day and time, with no leading ` on `", () => {
    expect(tripDayTime(reservation())).toBe(WHEN);
  });

  it("AC4: empty without both a date and a time", () => {
    const { date: _date, ...noDate } = reservation();
    const { time: _time, ...noTime } = reservation();
    expect(tripDayTime(noDate)).toBe("");
    expect(tripDayTime(noTime)).toBe("");
  });
});

describe("declineReasonOf", () => {
  it("AC5: the bank's code, or declined when it sent none", () => {
    expect(declineReasonOf("insufficient_funds")).toBe("insufficient_funds");
    expect(declineReasonOf(undefined)).toBe("declined");
  });
});

describe("balanceFailedBody", () => {
  const body = (outcome: BalanceFailure["outcome"], customerName = "Dana Whitcomb"): string =>
    balanceFailedBody({
      reservation: reservation({ customerName }),
      owedCents: 55294,
      manageUrl: URL,
      tenantName: "BrewBoat",
      outcome,
    });

  it("AC1: a decline carries the booking's link, the amount owed and the trip", () => {
    const text = body("declined");
    expect(text).toContain(URL);
    expect(text).toContain("$552.94");
    expect(text).toContain(WHEN);
  });

  it("AC2: a bank approval carries the same, in a different body", () => {
    const text = body("needs_approval");
    expect(text).toContain(URL);
    expect(text).toContain("$552.94");
    expect(text).toContain(WHEN);
    expect(text).not.toBe(body("declined"));
  });

  it.each(["declined", "needs_approval"] as const)("AC10: the %s body stays in GSM-7", (outcome) => {
    // The stray in the name proves the check read a real body, and that only the name is excused.
    const text = body(outcome, "Zoë Whitcomb");
    expect(nonGsm7Chars(text)).toEqual(["ë"]);
    expect(nonGsm7Chars(text, ["Zoë"])).toEqual([]);
  });
});

describe("balanceAdminAlertBody", () => {
  const body = (failure: BalanceFailure, over: Partial<Reservation> = {}): string =>
    balanceAdminAlertBody({ reservation: reservation(over), failure });

  it("AC4: a decline carries the customer's name, the trip, the amount owed, the reason and the next attempt's day", () => {
    const text = body(declined());
    for (const value of ["Dana Whitcomb", WHEN, "$552.94", "insufficient_funds", "Tue, Dec 1"]) {
      expect(text).toContain(value);
    }
  });

  it("AC4: the last attempt names no next day", () => {
    const text = body(declined({ nextAttemptAt: null }));
    expect(text).toContain("insufficient_funds");
    expect(text).not.toContain("Dec 1");
  });

  it("AC4: a decline with no code gives the reason Purchases shows for it", () => {
    expect(body(declined())).toContain("insufficient_funds");
    expect(body(declinedNoCode())).toBe(body(declined({ declineCode: "declined" })));
  });

  it("AC4: the attempts are counted from one", () => {
    // Every other figure in this body is free of 6 and 7.
    const text = body(declined({ attempt: 6, owedCents: 100000, nextAttemptAt: null }), {
      date: "2026-12-20",
      time: "10:00",
    });
    expect(text).toMatch(/\b7\b/);
    expect(text).not.toContain("6");
  });

  it("AC4: a bank approval carries the name, the trip and the amount, and no next attempt", () => {
    const text = body(NEEDS_APPROVAL);
    for (const value of ["Dana Whitcomb", WHEN, "$552.94"]) expect(text).toContain(value);
    expect(text).not.toBe(body(declined({ nextAttemptAt: null })));
  });

  it.each([
    ["declined", declined()],
    ["needs_approval", NEEDS_APPROVAL],
  ] as const)("AC4: the %s body cleans the typed name as the other money texts do, and is plain ASCII", (_label, failure) => {
    const text = body(failure, { customerName: "Zoë Whitcomb" });
    expect(text).toContain("Zo Whitcomb");
    expect(text).toMatch(/^[\x20-\x7e\n]*$/);

    const long = body(failure, { customerName: "Q".repeat(60) });
    expect(long).toContain("Q".repeat(40));
    expect(long).not.toContain("Q".repeat(41));
  });
});

describe("recordBalanceFailed", () => {
  it.each([
    ["a decline's code", declined({ attempt: 1 }), 1, "insufficient_funds"],
    ["declined, when the bank sent no code", declinedNoCode({ attempt: 2 }), 2, "declined"],
    ["needs_approval", NEEDS_APPROVAL, 0, "needs_approval"],
  ] as const)("AC5: the row's reason is %s", async (_label, failure, attempt, reason) => {
    const repo = new InMemoryRepository();

    await recordBalanceFailed({ repo, now: () => NOW }, RES, failure, "error");

    const rows = await repo.listTrailEventsFor(RES, []);
    expect(rows).toMatchObject([
      {
        id: `balance_charge_failed:${RES}:${attempt}`,
        reservationId: RES,
        type: "balance_charge_failed",
        actorKind: "engine",
        timestamp: NOW,
      },
    ]);
    expect(rows.map((r) => r.metadata)).toEqual([{ attempt, reason, outcome: "error" }]);
  });
});

describe("deliverBalanceNotice", () => {
  /** The console stand-in for a text channel: it records, and says it only logged. */
  class LoggedOnlyChannel extends FakeChannel {
    override async send(message: OutboundMessage): Promise<SendResult> {
      return { ...(await super.send(message)), loggedOnly: true };
    }
  }

  async function setup() {
    const repo = new InMemoryRepository();
    await repo.saveReservation(reservation());
    const email = new FakeChannel(() => new Date(NOW));
    const sms = new FakeChannel(() => new Date(NOW));
    const deps: BalanceNoticeDeps = {
      repo,
      now: () => NOW,
      tenantName: "BrewBoat",
      linkBase: LINK_BASE,
      email,
      sms,
      live: true,
    };
    return { repo, email, sms, deps, outcomes: async () => (await repo.listTrailEventsFor(RES, [])).map((r) => r.metadata) };
  }

  it("AC5: answers with the outcome it wrote on the row", async () => {
    const s = await setup();

    expect(await deliverBalanceNotice(s.deps, reservation(), declined())).toBe("email=sent sms=sent");

    expect(await s.outcomes()).toEqual([{ attempt: 0, reason: "insufficient_funds", outcome: "email=sent sms=sent" }]);
  });

  it("AC5: no email channel and a console text is skipped, and the send still runs so the body reaches the log", async () => {
    const s = await setup();
    const sms = new LoggedOnlyChannel(() => new Date(NOW));
    const { email: _email, ...noEmail } = s.deps;

    expect(await deliverBalanceNotice({ ...noEmail, sms, live: false }, reservation(), declined())).toBe("skipped");

    expect(sms.sent).toHaveLength(1);
    expect(await s.outcomes()).toEqual([{ attempt: 0, reason: "insufficient_funds", outcome: "skipped" }]);
  });

  it("AC1: a booking with no live code gets one, and that one is the link", async () => {
    const s = await setup();

    await deliverBalanceNotice(s.deps, reservation(), declined());

    const codes = await s.repo.listBookingCodesForReservation(RES);
    expect(codes).toHaveLength(1);
    const manageUrl = bookingUrl(LINK_BASE, codes[0]!.code);
    const expected = balanceFailedBody({
      reservation: reservation(),
      owedCents: 55294,
      manageUrl,
      tenantName: "BrewBoat",
      outcome: "declined",
    });
    expect(s.sms.sent.map((m) => m.body)).toEqual([expected]);
  });

  it("AC7: never throws, even with the repository gone altogether", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = await setup();
    vi.spyOn(s.repo, "listBookingCodesForReservation").mockRejectedValue(new Error("database unreachable"));
    vi.spyOn(s.repo, "appendTrailEvent").mockRejectedValue(new Error("database unreachable"));

    await expect(deliverBalanceNotice(s.deps, reservation(), declined())).resolves.toBe("error");
  });
});
