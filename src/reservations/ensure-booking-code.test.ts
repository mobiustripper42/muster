/**
 * Get-or-mint / reissue of a booking's manage code (#741, DEC-154).
 *
 * Runs against the in-memory double, which enforces the `booking_codes` PK for exactly this
 * reason — the retry loop is only testable if a duplicate throws (`repository-contract.ts` holds
 * Postgres to the same behaviour).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Reservation } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { ensureBookingCode, liveBookingCode, reissueBookingCode } from "./ensure-booking-code.js";

const RID = asId<"ReservationId">("resv-1");
let clock = "2026-08-14T12:00:00.000Z";
const now = () => clock;

/** A byte source producing a code of one repeated character — readable in failure output. */
const fixed = (ch: number) => (n: number) => Buffer.from(Array.from({ length: n }, () => ch));

const reservation = (id = RID): Reservation => ({
  id,
  eventId: asId<"EventId">("evt-1"),
  source: "muster",
  customerName: "Mary",
  partySize: 6,
  status: "booked",
});

describe("ensureBookingCode", () => {
  let repo: InMemoryRepository;
  beforeEach(async () => {
    repo = new InMemoryRepository();
    clock = "2026-08-14T12:00:00.000Z";
    await repo.saveReservation(reservation());
  });

  it("mints a code and stores it against the reservation", async () => {
    const code = await ensureBookingCode(repo, RID, now);
    expect(code).toHaveLength(14);
    expect((await repo.getBookingCode(code))!.reservationId).toBe(RID);
  });

  it("is idempotent — a redelivered webhook or a second resend reuses the live code", async () => {
    // The defect this prevents: a booking accumulating a fresh credential per Stripe retry, each
    // one live, each one separately revocable, none of them asked for.
    const first = await ensureBookingCode(repo, RID, now);
    const second = await ensureBookingCode(repo, RID, now);
    expect(second).toBe(first);
    expect(await repo.listBookingCodesForReservation(RID)).toHaveLength(1);
  });

  it("mints for a booking that never had a code — an imported Xola reservation", async () => {
    const imported = asId<"ReservationId">("resv-xola-legacy");
    await repo.saveReservation(reservation(imported));
    expect(await liveBookingCode(repo, imported, now)).toBeUndefined();
    const code = await ensureBookingCode(repo, imported, now);
    expect(await liveBookingCode(repo, imported, now)).toBe(code);
  });

  it("a revoked code is not reused — the next ensure mints a fresh one", async () => {
    const first = await ensureBookingCode(repo, RID, now);
    await repo.revokeBookingCode(first, "2026-08-14T13:00:00.000Z");
    const second = await ensureBookingCode(repo, RID, now);
    expect(second).not.toBe(first);
    expect(await repo.listBookingCodesForReservation(RID)).toHaveLength(2);
  });

  it("an expired code is not reused either", async () => {
    await repo.saveBookingCode({
      code: "AAAAAAAAAAAAAA",
      reservationId: RID,
      createdAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-10T00:00:00.000Z",
    });
    const code = await ensureBookingCode(repo, RID, now);
    expect(code).not.toBe("AAAAAAAAAAAAAA");
  });

  it("retries on a collision, then succeeds", async () => {
    // Park the code the first mint will produce, then let the second attempt differ.
    await repo.saveReservation(reservation(asId<"ReservationId">("resv-2")));
    await repo.saveBookingCode({
      code: "00000000000000",
      reservationId: asId<"ReservationId">("resv-2"),
      createdAt: "2026-08-01T00:00:00.000Z",
    });

    let call = 0;
    const collideOnce = (n: number) => (call++ === 0 ? fixed(0)(n) : fixed(1)(n));
    const code = await ensureBookingCode(repo, RID, now, collideOnce);

    expect(code).toBe("11111111111111");
    expect(call).toBe(2);
    // The parked code still belongs to the other booking — never repointed.
    expect((await repo.getBookingCode("00000000000000"))!.reservationId).toBe("resv-2");
  });

  it("gives up after three collisions rather than looping forever", async () => {
    await repo.saveReservation(reservation(asId<"ReservationId">("resv-2")));
    await repo.saveBookingCode({
      code: "00000000000000",
      reservationId: asId<"ReservationId">("resv-2"),
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    await expect(ensureBookingCode(repo, RID, now, fixed(0))).rejects.toThrow(/duplicate key/i);
  });

  it("rethrows a non-collision failure immediately", async () => {
    const broken = Object.assign(Object.create(InMemoryRepository.prototype) as InMemoryRepository, {
      listBookingCodesForReservation: async () => [],
      saveBookingCode: async () => {
        throw new Error("connection terminated unexpectedly");
      },
    });
    await expect(ensureBookingCode(broken, RID, now)).rejects.toThrow(/connection terminated/);
  });
});

describe("reissueBookingCode", () => {
  let repo: InMemoryRepository;
  beforeEach(async () => {
    repo = new InMemoryRepository();
    clock = "2026-08-14T12:00:00.000Z";
    await repo.saveReservation(reservation());
  });

  it("mints a new code and REVOKES the old one — the old link stops working", async () => {
    // The decision the whole feature turns on (DEC-154): a reissue kills its predecessor, or it
    // is cosmetic and a leaked link stays live forever.
    const old = await ensureBookingCode(repo, RID, now);
    clock = "2026-08-15T09:00:00.000Z";
    const { code: fresh, staleCodes } = await reissueBookingCode(repo, RID, now);

    expect(fresh).not.toBe(old);
    expect(staleCodes).toEqual([]); // nothing survived the reissue
    expect((await repo.getBookingCode(old))!.revokedAt).toBe("2026-08-15T09:00:00.000Z");
    expect((await repo.getBookingCode(fresh))!.revokedAt).toBeUndefined();
    expect(await liveBookingCode(repo, RID, now)).toBe(fresh);
  });

  it("a failed REVOKE reports the surviving code instead of throwing the new one away", async () => {
    // The mixed state, and the reason `staleCodes` exists. Past the mint there is a live
    // replacement in the table, so raising would discard a credential that already exists — but
    // the operator pressed this to CLOSE a link, and must not be told it closed when it didn't.
    const old = await ensureBookingCode(repo, RID, now);
    const failing = Object.assign(Object.create(InMemoryRepository.prototype) as InMemoryRepository, {
      listBookingCodesForReservation: async () => [
        { code: old, reservationId: RID, createdAt: "2026-08-14T12:00:00.000Z" },
      ],
      saveBookingCode: async () => undefined,
      revokeBookingCode: async () => {
        throw new Error("connection terminated unexpectedly");
      },
    });

    const { code, staleCodes } = await reissueBookingCode(failing, RID, now);
    expect(code).toHaveLength(14);
    expect(staleCodes).toEqual([old]);
  });

  it("revokes EVERY prior code, not just the most recent", async () => {
    const a = await ensureBookingCode(repo, RID, now);
    const { code: b } = await reissueBookingCode(repo, RID, now);
    const { code: c } = await reissueBookingCode(repo, RID, now);

    for (const dead of [a, b]) expect((await repo.getBookingCode(dead))!.revokedAt).toBeDefined();
    expect((await repo.getBookingCode(c))!.revokedAt).toBeUndefined();
    expect(await liveBookingCode(repo, RID, now)).toBe(c);
  });

  it("works on a booking that had no code at all", async () => {
    const { code } = await reissueBookingCode(repo, RID, now);
    expect(await liveBookingCode(repo, RID, now)).toBe(code);
  });

  it("a failed mint leaves the customer's existing link alive", async () => {
    // Mint FIRST, revoke second. The reverse order would strand a customer whose link was the
    // only one they had, on a failure they never saw.
    await repo.saveReservation(reservation(asId<"ReservationId">("resv-2")));
    const old = await ensureBookingCode(repo, RID, now);
    await repo.saveBookingCode({
      code: "00000000000000",
      reservationId: asId<"ReservationId">("resv-2"),
      createdAt: "2026-08-01T00:00:00.000Z",
    });

    await expect(reissueBookingCode(repo, RID, now, fixed(0))).rejects.toThrow();
    expect((await repo.getBookingCode(old))!.revokedAt).toBeUndefined();
    expect(await liveBookingCode(repo, RID, now)).toBe(old);
  });
});
