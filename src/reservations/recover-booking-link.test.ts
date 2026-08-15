/**
 * "Lost your link?" recovery (12.7, issue #460).
 *
 * The tests are mostly about what the caller CANNOT learn. A recovery form that behaves
 * differently on a hit is an oracle for who has booked with this operator.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event, Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { ChannelPort, OutboundMessage, SendResult } from "../ports/channel.js";
import { contactKey, recoverBookingLink } from "./recover-booking-link.js";
import type { RecoveryRow } from "./find-booking.js";

const TODAY = "2026-08-15";
const NOW = "2026-08-15T12:00:00.000Z";
const BASE = "https://muster.example";

function capturing(throwOnSend = false): ChannelPort & { sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  return {
    sent,
    async send(m: OutboundMessage): Promise<SendResult> {
      if (throwOnSend) throw new Error("channel down");
      sent.push(m);
      return { deliveredAt: NOW };
    },
  };
}

const reservation: Reservation = {
  id: asId<"ReservationId">("resv-1"),
  eventId: asId<"EventId">("evt-1"),
  source: "muster",
  customerName: "Marcus Webb",
  partySize: 4,
  email: "marcus@example.com",
  phone: "+12165550148",
  status: "booked",
};

const event = {
  id: asId<"EventId">("evt-1"),
  vesselId: asId<"VesselId">("v-1"),
  date: "2026-09-12",
  time: "13:30",
  capacity: 12,
  status: "scheduled",
  source: "muster",
} as Event;

const rows: RecoveryRow[] = [{ reservation, event }];

describe("recoverBookingLink", () => {
  let repo: InMemoryRepository;
  let email: ReturnType<typeof capturing>;
  let sms: ReturnType<typeof capturing>;
  const deps = () => ({ repo, email, sms, linkBase: BASE, now: () => NOW, today: TODAY });

  beforeEach(async () => {
    repo = new InMemoryRepository();
    email = capturing();
    sms = capturing();
    await repo.saveReservation(reservation);
  });

  it("sends the manage link to the contact on file when everything matches", async () => {
    await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "marcus@example.com", lastName: "Webb" });

    expect(email.sent).toHaveLength(1);
    const url = email.sent[0]!.body.match(/https:\/\/\S+/)![0];
    expect(url).toMatch(new RegExp(`^${BASE}/b/[0-9A-Z]{14}$`));
    // The code is real — it resolves to this booking, not a string that merely looks right.
    const code = url.split("/").pop()!;
    expect((await repo.getBookingCode(code))!.reservationId).toBe("resv-1");
  });

  it("sends to the STORED contact, not the typed one", async () => {
    // Equal today on an exact match, which is the point — asserting it is what stops a future
    // looser match from turning this into a disclosure.
    await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "MARCUS@EXAMPLE.COM", lastName: "webb" });
    expect(email.sent[0]!.to).toEqual({ email: "marcus@example.com" });
    expect(sms.sent[0]!.to).toEqual({ phone: "+12165550148" });
  });

  it("mints a code for a booking that never had one", async () => {
    expect(await repo.listBookingCodesForReservation(reservation.id)).toHaveLength(0);
    await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "marcus@example.com", lastName: "Webb" });
    expect(await repo.listBookingCodesForReservation(reservation.id)).toHaveLength(1);
  });

  it("reuses the live code rather than reissuing — recovery is not a revocation", async () => {
    // The customer asking for their link back has not said the old one leaked. Minting a new one
    // and killing the old would break the link on the phone they are holding.
    await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "marcus@example.com", lastName: "Webb" });
    const first = (await repo.listBookingCodesForReservation(reservation.id))[0]!.code;

    await repo.claimRecoverySend("marcus@example.com", "2026-08-15T13:00:00.000Z", "2026-08-15T13:00:00.000Z");
    await recoverBookingLink(
      { ...deps(), now: () => "2026-08-15T14:00:00.000Z" },
      () => Promise.resolve(rows),
      { contact: "marcus@example.com", lastName: "Webb" },
    );
    const codes = await repo.listBookingCodesForReservation(reservation.id);
    expect(codes).toHaveLength(1);
    expect(codes[0]!.code).toBe(first);
  });

  it("RETURNS THE SAME THING on a miss as on a hit — the whole point", async () => {
    // Nothing a caller could branch on: no value, no throw. A form that renders "no booking
    // found" tells a stranger whether an address has booked with this operator.
    const hit = await recoverBookingLink(deps(), () => Promise.resolve(rows), {
      contact: "marcus@example.com",
      lastName: "Webb",
    });
    const missName = await recoverBookingLink(deps(), () => Promise.resolve(rows), {
      contact: "marcus@example.com",
      lastName: "Nguyen",
    });
    const missContact = await recoverBookingLink(deps(), () => Promise.resolve(rows), {
      contact: "nobody@example.com",
      lastName: "Webb",
    });

    expect(hit).toBeUndefined();
    expect(missName).toBeUndefined();
    expect(missContact).toBeUndefined();
    // …and only the hit actually sent anything.
    expect(email.sent).toHaveLength(1);
  });

  it("does NOT read the world when the throttle refuses — the bound is on the work, not just the send", async () => {
    // Review finding. Taking the rows eagerly meant an attacker cycling fresh contacts forced a
    // full reservations+events scan on every request, for free, no matter what the throttle
    // said. The thunk is what makes the migration's stated bound actually true.
    let reads = 0;
    const loadRows = async () => {
      reads += 1;
      return rows;
    };

    await recoverBookingLink(deps(), loadRows, { contact: "marcus@example.com", lastName: "Webb" });
    expect(reads).toBe(1);

    // Second request inside the window: refused at the claim, before any read.
    await recoverBookingLink(deps(), loadRows, { contact: "marcus@example.com", lastName: "Webb" });
    expect(reads).toBe(1);
  });

  it("does not read the world for an unusable contact either", async () => {
    let reads = 0;
    await recoverBookingLink(
      deps(),
      async () => {
        reads += 1;
        return rows;
      },
      { contact: "not-a-contact", lastName: "Webb" },
    );
    expect(reads).toBe(0);
  });

  it("swallows a channel failure — an error would itself be a signal", async () => {
    const broken = capturing(true);
    await expect(
      recoverBookingLink({ ...deps(), email: broken, sms: broken }, () => Promise.resolve(rows), {
        contact: "marcus@example.com",
        lastName: "Webb",
      }),
    ).resolves.toBeUndefined();
  });

  it("swallows a repository failure too, and reports it out of band", async () => {
    const onFailure = vi.fn();
    const brokenRepo = {
      claimRecoverySend: async () => {
        throw new Error("connection terminated unexpectedly");
      },
    } as unknown as InMemoryRepository;

    await expect(
      recoverBookingLink({ ...deps(), repo: brokenRepo, onFailure }, () => Promise.resolve(rows), {
        contact: "marcus@example.com",
        lastName: "Webb",
      }),
    ).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  describe("the throttle", () => {
    it("a second request inside the window sends nothing", async () => {
      await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "marcus@example.com", lastName: "Webb" });
      await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "marcus@example.com", lastName: "Webb" });
      expect(email.sent).toHaveLength(1);
    });

    it("bounds the NO-MATCH path too — the one an abuser uses", async () => {
      // Claimed before matching. If only successful matches were throttled, an attacker could
      // grind the form for free and every miss would still cost a database read.
      await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "marcus@example.com", lastName: "Nguyen" });
      // Same contact, now with the RIGHT name — still refused, because the window is taken.
      await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "marcus@example.com", lastName: "Webb" });
      expect(email.sent).toHaveLength(0);
    });

    it("throttles by canonical contact, so respelling a phone is not a fresh attempt", async () => {
      await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "+1 216 555 0148", lastName: "Webb" });
      await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "(216) 555-0148", lastName: "Webb" });
      expect(sms.sent).toHaveLength(1);
    });

    it("lets the same contact through once the window passes", async () => {
      await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "marcus@example.com", lastName: "Webb" });
      await recoverBookingLink(
        { ...deps(), now: () => "2026-08-15T12:16:00.000Z" },
        () => Promise.resolve(rows),
        { contact: "marcus@example.com", lastName: "Webb" },
      );
      expect(email.sent).toHaveLength(2);
    });

    it("does not throttle a different contact", async () => {
      // One person's request must not silence another's. Note each successful recovery sends on
      // EVERY channel the booking has, so one request is one email AND one text — the second
      // request landing is what takes both counts to two.
      await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "marcus@example.com", lastName: "Webb" });
      expect([email.sent.length, sms.sent.length]).toEqual([1, 1]);

      // A different contact key (the phone, not the email) — a fresh window.
      await recoverBookingLink(deps(), () => Promise.resolve(rows), { contact: "+12165550148", lastName: "Webb" });
      expect([email.sent.length, sms.sent.length]).toEqual([2, 2]);
    });
  });
});

describe("contactKey", () => {
  it("canonicalizes so one person is one bucket", () => {
    expect(contactKey(" Marcus@Example.com ")).toBe("marcus@example.com");
    expect(contactKey("(216) 555-0148")).toBe("+12165550148");
    expect(contactKey("216.555.0148")).toBe("+12165550148");
  });

  it("refuses what cannot be a contact, keeping junk out of the throttle table", () => {
    expect(contactKey("")).toBeNull();
    expect(contactKey("   ")).toBeNull();
    expect(contactKey("555")).toBeNull();
  });
});
