/**
 * Postgres adapter — runs the shared Repository contract (DEC-020) against real
 * Postgres. **Skips cleanly when no test DB is reachable** (same posture as the
 * import smoke test that skips if the real file is absent), so `npm run test` /
 * `verify` stay Docker-free; `npm run test:pg` (with `docker compose up -d`)
 * exercises it. Migrates the test DB once, truncates before each test.
 */
import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { migrate } from "../../db/migrate.js";
import { PostgresRepository } from "./postgres-repository.js";
import { runRepositoryContract } from "./repository-contract.js";
import { clockIn } from "../crew/time-clock.js";
import { FAKE_SIGNATURE, FakePaymentPort } from "./fake-payment.js";
import {
  processBookingWebhook,
  paymentIdFor,
  type WebhookDeps,
} from "../reservations/booking-webhook.js";
import { writeSlotBooking } from "../reservations/write-booking.js";
import { eventIdForSlot } from "../reservations/availability.js";
import { asId } from "../domain/ids.js";
import type { TimePunch } from "../domain/entities.js";
import type { CrewMemberId, TimePunchId } from "../domain/ids.js";

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://muster:muster@localhost:5432/muster_test";

const TABLES = [
  "role_types",
  "vessels",
  "crew_members",
  "credentials",
  "pto_windows",
  "time_punches",
  "time_punch_edits",
  "events",
  "reservations",
  "offerings",
  "locations",
  "add_ons",
  "customers",
  "blocks",
  "checkout_holds",
  "gratuity",
  "payments",
  "shifts",
  "seats",
  "asks",
  "magic_tokens",
  "admins",
  "login_codes",
  "calendar_feeds",
  "outbox_entries",
  "ring_outbox",
  "notice_outbox",
  "reliability_events",
  "sms_consent",
  "app_settings",
  "import_runs",
  "import_run_items",
  "threads",
  "thread_participants",
  "messages",
  "message_reads",
  "doorbell_notifications",
];

async function canConnect(url: string): Promise<boolean> {
  // Short timeout so a down DB skips fast instead of hanging the suite.
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

// Top-level probe so the suite can register skipped when Docker/Postgres is down.
const dbUp = await canConnect(TEST_URL);

if (!dbUp) {
  describe.skip("Repository contract — postgres (no TEST DB reachable)", () => {
    it("skipped — run `docker compose up -d` then `npm run test:pg`", () => {});
  });
} else {
  const pool = new pg.Pool({ connectionString: TEST_URL });
  await migrate(TEST_URL);

  runRepositoryContract("postgres", async () => {
    await pool.query(
      `truncate ${TABLES.join(", ")} restart identity cascade`,
    );
    return new PostgresRepository(pool);
  });

  /**
   * The one-open-punch invariant (SPEC §2.9.4) lives in the DATABASE — a partial
   * unique index — so this is the only place it can be proven. The in-memory double
   * deliberately doesn't enforce constraints (DEC-131), which is exactly why the
   * contract suite can't cover this and why it gets its own describe here.
   */
  describe("time punches — the one-open-punch index (§2.9.4)", () => {
    const CREW = asId<"CrewMemberId">("crew-a");
    const openPunch = (id: string): TimePunch => ({
      id: asId<"TimePunchId">(id),
      crewMemberId: CREW,
      inAt: "2026-07-15T13:00:00.000Z",
      outAt: null,
      shiftId: null,
      origin: "crew",
      adminEditedAt: null,
    });

    async function freshRepo(): Promise<PostgresRepository> {
      await pool.query(`truncate ${TABLES.join(", ")} restart identity cascade`);
      const repo = new PostgresRepository(pool);
      await repo.saveCrewMember({
        id: CREW,
        name: "Quint",
        phone: "555",
        ratings: [],
        status: "active",
        reliabilityScore: null,
      });
      return repo;
    }

    it("a second OPEN punch for the same crew member is refused by the database", async () => {
      const repo = await freshRepo();
      await repo.saveTimePunch(openPunch("punch-1"));

      await expect(repo.saveTimePunch(openPunch("punch-2"))).rejects.toMatchObject({
        code: "23505",
      });
      const rows = await repo.listTimePunchesForCrew(CREW);
      expect(rows).toHaveLength(1);
    });

    it("two concurrent clockIns produce ONE punch and an already_in — not a 500", async () => {
      // The race the index exists for: both calls read "nothing open" before either
      // writes, so the application-level check in `clockIn` passes twice and only
      // the constraint stops the second row. The loser must come back as the same
      // calm `already_in` a sequential double-tap gets.
      const repo = await freshRepo();
      const at = new Date("2026-07-15T13:00:00.000Z");

      const [a, b] = await Promise.all([
        clockIn(repo, { id: asId<"TimePunchId">("punch-a"), crewMemberId: CREW, at }),
        clockIn(repo, { id: asId<"TimePunchId">("punch-b"), crewMemberId: CREW, at }),
      ]);

      const outcomes = [a, b];
      expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
      expect(outcomes.filter((r) => !r.ok && r.code === "already_in")).toHaveLength(1);
      expect(await repo.listTimePunchesForCrew(CREW)).toHaveLength(1);
    });

    it("closing a punch frees the slot — the index constrains OPEN rows only", async () => {
      const repo = await freshRepo();
      await repo.saveTimePunch(openPunch("punch-1"));
      await repo.saveTimePunch({
        ...openPunch("punch-1"),
        outAt: "2026-07-15T21:00:00.000Z",
      });

      await repo.saveTimePunch(openPunch("punch-2"));
      expect(await repo.listTimePunchesForCrew(CREW)).toHaveLength(2);
      expect(await repo.getOpenPunchForCrew(CREW)).toMatchObject({ id: "punch-2" });
    });

    it("a crew member with punches cannot be deleted out from under them", async () => {
      // `on delete restrict`: hours already worked are still owed, so this must
      // fail loudly rather than cascade a paycheck into the void.
      const repo = await freshRepo();
      await repo.saveTimePunch(openPunch("punch-1"));

      await expect(
        pool.query("delete from crew_members where id=$1", [CREW]),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });


  /**
   * Paid-but-unbooked: the `payments` → `reservations` FK (#613).
   *
   * **This can only be proven here, for the same reason the one-open-punch index above can.**
   * `payments.reservation_id` is `not null` with an immediate FK to `reservations(id)`
   * (`db/migrations/20260715024322_payments.sql:26`, `20260722170000_fk_reservations_era.sql:44`).
   * `InMemoryRepository.savePayment` is a `Map.set` with no referential integrity (DEC-131), so
   * the unit suite happily "records a payment" against a reservation that was never written and
   * proves nothing about production.
   *
   * The bug: `processBookingCharge` recorded the Payment BEFORE branching on the outcome. On a
   * `lost` or `unbookable` outcome no reservation exists, the insert violated the FK, and the
   * throw took out everything after it — the DEC-107 auto-refund, the sold-out notice to the
   * customer, and the operator alert. Stripe then retried into the same violation for ~3 days.
   * Net: charged, unbooked, unrefunded, unreported. #472 is closed asserting that auto-refund
   * works; it could never run.
   */
  describe("paid-but-unbooked — the payments→reservations FK (#613)", () => {
    const EVENT = asId<"EventId">("m-evt-pg-1");
    const NOW = () => "2026-07-12T00:00:00.000Z";

    const completed = (over: Record<string, unknown> = {}) => ({
      sessionId: "cs_pg_1",
      paymentIntentId: "pi_pg_1",
      amountTotalCents: 53625,
      currency: "usd",
      // Slot-shaped since #693 retired the legacy `eventId` booking path.
      metadata: {
        offeringId: "off-pg",
        vesselId: "vessel-brew-1",
        date: "2026-07-04",
        time: "17:00",
        guestCount: "6",
        priceCents: "50000",
        kind: "full",
        taxCents: "3625",
        customerName: "Mary",
        email: "m@x.io",
      },
      ...over,
    });

    async function freshRepo(): Promise<PostgresRepository> {
      await pool.query(`truncate ${TABLES.join(", ")} restart identity cascade`);
      return new PostgresRepository(pool);
    }

    function makeDeps(repo: PostgresRepository, payments = new FakePaymentPort()) {
      const alert = vi.fn(async (_m: string) => {});
      const soldOut = vi.fn(async (_c: unknown) => {});
      const deps: WebhookDeps = {
        repo,
        reservationsEnabled: true,
        payments,
        now: NOW,
        alertPaidButUnbooked: alert,
        sendConfirmation: vi.fn(async (_r: unknown) => {}),
        notifyCustomerSoldOut: soldOut,
      };
      return { deps, alert, soldOut, payments };
    }

    it("the FK is real: a payment against a reservation that was never written is REFUSED", async () => {
      // Pins the premise the rest of this block rests on. If this ever stops throwing, the
      // in-memory double and Postgres have converged and the unit tests regain their meaning —
      // but until then, a green unit test here means nothing.
      const repo = await freshRepo();
      await expect(
        repo.savePayment({
          id: asId<"PaymentId">("pay_orphan"),
          reservationId: asId<"ReservationId">("res-does-not-exist"),
          method: "stripe",
          kind: "full",
          amountCents: 1000,
          taxCents: 0,
          currency: "usd",
          status: "succeeded",
          createdAt: NOW(),
        }),
      ).rejects.toThrow();
    });

    it("an UNBOOKABLE charge alerts the operator instead of crashing the webhook", async () => {
      // The deterministic unbookable used to be `event_missing` — a charge naming an event not in
      // the database, which only the legacy path could produce. #693 retired that path, so the
      // remaining deterministic one is a session carrying NO SLOT: refused before anything is
      // parsed or written. Deliberately not auto-refunded (a human investigates); the alert is
      // the whole safety net, and it sat behind the FK throw.
      //
      // Converted rather than deleted because what this pins is the #613 guard against an orphan
      // payment on a non-booked outcome, and that needs a real FK — which only Postgres has
      // (DEC-131). Any non-booked outcome will do; the shape of it is incidental.
      const repo = await freshRepo();
      const { deps, alert } = makeDeps(repo);

      const noSlot = completed({
        metadata: { eventId: String(EVENT), partySize: "6", kind: "full", taxCents: "3625", customerName: "Mary" },
      });
      const r = await processBookingWebhook(deps, JSON.stringify(noSlot), FAKE_SIGNATURE);

      expect(r.handled).toBe(true);
      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[0]![0]).toMatch(/REFUND MANUALLY/i);
      // And no orphan payment was left behind.
      expect(await repo.getPayment(paymentIdFor("cs_pg_1"))).toBeNull();
    });

    it("a LOST race refunds the customer, tells them, and leaves no orphan payment", async () => {
      // A real residual race needs a rival to win the CAS between our pre-check and our write —
      // not reproducible by sequencing alone. So `saveBookingIfSlotFree` is failed ONCE, which is
      // precisely what losing the race looks like to this code. Everything else — events,
      // reservations, payments — is real Postgres.
      //
      // It used to stub `saveReservationIfUnclaimed`; #693 retired that path, and the slot CAS is
      // what the webhook actually calls now. Stubbing the method nothing calls would have left
      // this test green while simulating nothing.
      const repo = await freshRepo();
      await repo.saveEvent({
        id: EVENT,
        vesselId: asId<"VesselId">("vessel-brew-1"),
        date: "2026-07-04",
        time: "17:00",
        capacity: 12,
        status: "scheduled",
        source: "muster",
        price: 50000,
      });
      // A Proxy, not `Object.create` — `PostgresRepository` holds its pool in a `#private`
      // field, and prototype delegation cannot carry those (every real call then dies with
      // "Cannot read private member #pool"). `Reflect.get(t, prop, t)` keeps the receiver on the
      // target so the private field resolves, and methods are bound for the same reason.
      const lose = new Proxy(repo, {
        get(t, prop) {
          if (prop === "saveBookingIfSlotFree") return async () => ({ result: "lost" });
          const v = Reflect.get(t, prop, t);
          return typeof v === "function" ? v.bind(t) : v;
        },
      }) as PostgresRepository;
      const { deps, alert, soldOut, payments } = makeDeps(lose);

      const r = await processBookingWebhook(deps, JSON.stringify(completed()), FAKE_SIGNATURE);

      expect(r).toEqual({ handled: true, outcome: "lost" });
      // Refunded automatically…
      expect(payments.refunds).toHaveLength(1);
      // …the customer is told they were refunded…
      expect(soldOut).toHaveBeenCalledTimes(1);
      // …and no manual-refund alarm, because nothing needed a human.
      expect(alert).not.toHaveBeenCalled();
      // No payment row: there is no reservation to hang it on, and Stripe holds the record of
      // money that never became a booking.
      expect(await repo.getPayment(paymentIdFor("cs_pg_1"))).toBeNull();
    });
  });


  /**
   * Two buyers, one seat, genuinely at the same time (#613 follow-on).
   *
   * **Every other test of this race is stubbed.** The `#613` block above forces the loss through
   * a Proxy over `saveBookingIfSlotFree`. That proves what happens *given* a lost outcome; it
   * does not prove a real collision produces one. The operator called that out — "we have to
   * trust the script that it actually creates the race condition" — and he was right: the link
   * was asserted nowhere.
   *
   * This runs two real `writeSlotBooking` calls concurrently against one slot in real Postgres,
   * so the conditional write — `saveBookingIfSlotFree`, the CAS the whole DEC-109/125 design
   * rests on — is the thing under test rather than a stub of it. (It named
   * `saveReservationIfUnclaimed` until #693 retired that path.)
   *
   * The loser reads `lost` — `writeSlotBooking` returns only booked/already/lost, so the
   * `unbookable/already_claimed` variant this used to allow for went with the retired path.
   * **The invariant that matters is that the boat is sold exactly once.**
   */
  describe("two buyers, one seat, concurrently — the claim CAS (DEC-109)", () => {
    const EVENT2 = asId<"EventId">("m-evt-pg-race");
    const NOW2 = () => "2026-07-12T00:00:00.000Z";

    it("sells the seat exactly once, and the loser is never booked", async () => {
      await pool.query(`truncate ${TABLES.join(", ")} restart identity cascade`);
      const repo = new PostgresRepository(pool);
      // Capacity 6 with two parties of 6: only ONE can fit, so they genuinely contend.
      await repo.saveEvent({
        id: EVENT2,
        vesselId: asId<"VesselId">("vessel-brew-1"),
        date: "2026-07-04",
        time: "17:00",
        capacity: 6,
        status: "scheduled",
        source: "muster",
        price: 50000,
      });

      // Through `writeSlotBooking` since #693 retired `writeBooking`. Both buyers contend on the
      // SAME slot identity, which is the case the sibling test below does NOT cover — that one
      // contends on two different times against one hull (#691). Keeping both matters: the
      // same-slot race is caught by the partial unique index plus the conditional insert, the
      // overlapping-times race by the hull-day advisory lock, and they are different mechanisms.
      const buyer = (key: string, name: string) => ({
        offeringId: asId<"OfferingId">("off-race"),
        vesselId: asId<"VesselId">("vessel-brew-1"),
        date: "2026-07-04",
        time: "17:00",
        guestCount: 6,
        priceCents: 50000,
        extrasCents: 0,
        customerName: name,
        idempotencyKey: key,
      });

      const [a, b] = await Promise.all([
        writeSlotBooking(repo, buyer("sess_a", "Ann"), NOW2),
        writeSlotBooking(repo, buyer("sess_b", "Ben"), NOW2),
      ]);

      const outcomes = [a.outcome, b.outcome].sort();
      // Exactly one winner…
      expect(outcomes.filter((o) => o === "booked")).toHaveLength(1);
      // …and the loser did NOT book. `lost` is the residual-race loss; what must never happen is
      // two bookings, or a loser that reads as booked.
      const loser = a.outcome === "booked" ? b : a;
      expect(loser.outcome).toBe("lost");

      // The invariant, stated on the data rather than on the return values: one slot, one row.
      // Read the event id off the WINNER rather than re-deriving it — re-deriving would pass a
      // second copy of the same assumption through the assertion and prove nothing if the
      // derivation itself drifted.
      const winner = a.outcome === "booked" ? a : b;
      const rows = await repo.listReservationsForEvent(
        (winner as { eventId: EventId }).eventId,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("booked");
    });
  });

  /**
   * Two buyers, one HULL, overlapping-but-different times (#691).
   *
   * The sibling race above contends on ONE event id, which the whole-boat mutex has always
   * handled. This one contends on two DIFFERENT slot identities on the same boat — 13:30 and
   * 14:00 against a 100-minute trip. Every guard that existed keyed on the exact triple: the
   * partial unique index, the `not exists` reservation check. Both writes used to succeed, and
   * nothing anywhere reported it (#613's net only fires when a write is REJECTED).
   *
   * A row lock cannot close this — `for update` locks rows that exist, and the rival's row is a
   * phantom until it inserts. The advisory lock on the hull-day is what makes it real, and this
   * test is the only thing that proves the lock is doing the work: negative-control it by
   * deleting the `pg_advisory_xact_lock` line and this goes red with two bookings.
   */
  describe("two buyers, one hull, overlapping times — the #691 hole", () => {
    const VESSEL3 = asId<"VesselId">("vessel-brew-7");
    const DATE3 = "2026-07-04";
    const NOW3 = () => "2026-07-12T00:00:00.000Z";

    it("sells the boat exactly once across two overlapping departures", async () => {
      await pool.query(`truncate ${TABLES.join(", ")} restart identity cascade`);
      const repo = new PostgresRepository(pool);

      const booking = (time: string, name: string) => {
        const id = eventIdForSlot(VESSEL3, DATE3, time);
        return {
          event: {
            id,
            vesselId: VESSEL3,
            date: DATE3,
            time,
            capacity: 12,
            status: "scheduled" as const,
            source: "muster" as const,
            durationMinutes: 100,
          },
          reservation: {
            id: asId<"ReservationId">(`resv-${time}`),
            eventId: id,
            source: "muster" as const,
            customerName: name,
            partySize: 4,
            status: "booked" as const,
          },
        };
      };

      const a = booking("13:30", "Ann"); // 13:30 → 15:10
      const b = booking("14:00", "Ben"); // 14:00 → 15:40, overlapping Ann by 70 minutes

      const [ra, rb] = await Promise.all([
        repo.saveBookingIfSlotFree(a.event, a.reservation),
        repo.saveBookingIfSlotFree(b.event, b.reservation),
      ]);

      // Exactly one winner. Which one depends on interleaving and is not worth pinning.
      const results = [ra.result, rb.result].sort();
      expect(results).toEqual(["lost", "won"]);

      // The invariant stated on the data, not the return values: one boat, one booked party
      // on that day. This is the assertion that reads `2` without the advisory lock.
      const { rows } = await pool.query(
        `select count(*)::int as n from reservations r
           join events e on e.id = r.event_id
          where e.vessel_id = $1 and e.date = $2 and r.status = 'booked'`,
        [VESSEL3, DATE3],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  afterAll(async () => {
    await pool.end();
  });
}
