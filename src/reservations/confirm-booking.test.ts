/**
 * `confirmBookingByPaymentIntent` — the booking confirm, callable without a webhook (issue #827).
 *
 * `SPEC.md` §2.8 acceptance criterion 13: *"Killing the webhook entirely still produces a booking
 * for a customer who reaches the success page."* Today it does not — `book/success/page.tsx` is
 * static copy, so `payment_intent.succeeded` is the ONLY path that ever books. A delayed or
 * misconfigured endpoint means the customer has paid and nothing has happened.
 *
 * Stripe's own fulfillment guidance is to trigger from both: *"webhooks can sometimes be
 * delayed... trigger fulfillment from your landing page as well."* §2.8.6 requires both callers
 * to run the SAME idempotent function, because Stripe re-delivers events processed elsewhere and
 * a second path that books its own way books twice.
 *
 * These tests use NO webhook payload and NO signature. That is the point: the only input is a
 * PaymentIntent id, which is what the browser is handed on the redirect.
 */
import { describe, expect, it, vi } from "vitest";
import { FakePaymentPort } from "../adapters/fake-payment.js";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import type { Event } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import type { WebhookDeps } from "./booking-webhook.js";
import { confirmBookingByPaymentIntent } from "./confirm-booking.js";

/** `WebhookResult` is a union — `{handled:false}` has no `outcome`. Narrow rather than index. */
const outcomeOf = (r: Awaited<ReturnType<typeof confirmBookingByPaymentIntent>>) =>
  "outcome" in r ? r.outcome : "unhandled";

const NOW = () => "2026-07-12T00:00:00.000Z";

const SLOT_METADATA = {
  purpose: "booking",
  offeringId: "off-1",
  vesselId: "v",
  date: "2026-07-04",
  time: "17:00",
  guestCount: "6",
  priceCents: "50000",
  kind: "full",
  taxCents: "3625",
  customerName: "Mary",
  email: "m@x.io",
};

const musterEvent = (over: Partial<Event> = {}): Event => ({
  id: asId<"EventId">("m-evt-1"),
  vesselId: asId<"VesselId">("v"),
  date: "2026-07-04",
  time: "17:00",
  capacity: 12,
  status: "scheduled",
  source: "muster",
  price: 50000,
  ...over,
});

function makeDeps(repo: InMemoryRepository, payments: FakePaymentPort) {
  const alert = vi.fn(async (_m: string) => {});
  const confirm = vi.fn(async (_r: unknown) => {});
  const soldOut = vi.fn(async (_c: unknown) => {});
  const deps: WebhookDeps = {
    repo,
    reservationsEnabled: true,
    payments,
    now: NOW,
    alertPaidButUnbooked: alert,
    sendConfirmation: confirm,
    notifyCustomerSoldOut: soldOut,
  };
  return { deps, alert, confirm, soldOut };
}

async function seeded() {
  const repo = new InMemoryRepository();
  await repo.saveOffering({
    id: asId<"OfferingId">("off-1"),
    tenantId: asId<"TenantId">("t"),
    name: "Hops",
    status: "live",
    basePriceCents: 50000,
  } as never);
  await repo.saveVessel({ id: asId<"VesselId">("v"), name: "Brew", coiMaxPax: 12, manning: [] });
  return repo;
}

/** The pending row checkout wrote for `SLOT_METADATA`'s slot, carrying the intent confirm finds
 *  (14.5). Without it, confirm resolves `unbookable` — there is nothing to flip. */
async function seedPending(repo: InMemoryRepository, paymentIntentId: string): Promise<void> {
  await repo.saveReservation({
    id: asId<"ReservationId">(`resv-${paymentIntentId}`),
    eventId: null,
    source: "muster",
    status: "pending",
    customerName: "Mary",
    email: "m@x.io",
    partySize: 6,
    vesselId: asId<"VesselId">("v"),
    date: "2026-07-04",
    time: "17:00",
    offeringId: asId<"OfferingId">("off-1"),
    reservedAt: "2026-07-11T23:55:00.000Z", // inside the window before NOW
    holdMinutes: 120,
    tripMinutes: 100,
    paymentIntentId,
  });
}

describe("confirmBookingByPaymentIntent — the success page books without a webhook (issue #827)", () => {
  it("books a succeeded PaymentIntent, given only its id and no webhook at all", async () => {
    const repo = await seeded();
    await seedPending(repo, "pi_success_1");
    const payments = new FakePaymentPort();
    payments.succeededIntents.set("pi_success_1", {
      paymentIntentId: "pi_success_1",
      amountReceivedCents: 53625,
      currency: "usd",
      metadata: SLOT_METADATA,
    });
    const { deps } = makeDeps(repo, payments);

    const out = await confirmBookingByPaymentIntent(deps, "pi_success_1");

    expect(outcomeOf(out)).toBe("booked");
    expect(await repo.listAllReservations()).toHaveLength(1);
  });

  it("is idempotent — the webhook landing afterwards produces no second booking", async () => {
    const repo = await seeded();
    await seedPending(repo, "pi_success_2");
    const payments = new FakePaymentPort();
    payments.succeededIntents.set("pi_success_2", {
      paymentIntentId: "pi_success_2",
      amountReceivedCents: 53625,
      currency: "usd",
      metadata: SLOT_METADATA,
    });
    const { deps } = makeDeps(repo, payments);

    await confirmBookingByPaymentIntent(deps, "pi_success_2");
    const second = await confirmBookingByPaymentIntent(deps, "pi_success_2");

    expect(outcomeOf(second)).toBe("already");
    expect(await repo.listAllReservations()).toHaveLength(1);
  });

  it("refuses a PaymentIntent Stripe does not report as succeeded — the redirect is not proof", async () => {
    const repo = await seeded();
    const payments = new FakePaymentPort();
    // Nothing registered: Stripe has no record of this id succeeding. A crafted
    // `?payment_intent=` on the success URL must not book anything.
    const { deps } = makeDeps(repo, payments);

    const out = await confirmBookingByPaymentIntent(deps, "pi_forged");

    expect(outcomeOf(out)).toBe("ignored");
    expect(await repo.listAllReservations()).toHaveLength(0);
  });

  it("does NOT refund or notify on a residual-race loss — that is the webhook's job", async () => {
    // The loss is STABLE: no reservation row is written, so every replay re-derives `lost`. This
    // entry point is a public GET anyone can issue in a loop, so running the compensation here
    // would re-send a customer's "sold out while you were paying" SMS and email on every request,
    // and re-attempt a refund whose Stripe idempotency key expires after a day — after which the
    // failure alert texts every admin instead. Reported, not acted on; the webhook still does it.
    const repo = await seeded();
    const payments = new FakePaymentPort();
    // A rival already owns the slot, so this charge loses the atomic claim.
    await repo.saveEvent(musterEvent());
    await repo.saveReservation({
      id: asId<"ReservationId">("rival"),
      eventId: asId<"EventId">("m-evt-1"),
      customerName: "Rival",
      partySize: 12,
      status: "booked",
      source: "muster",
    } as never);
    await seedPending(repo, "pi_loser");
    payments.succeededIntents.set("pi_loser", {
      paymentIntentId: "pi_loser",
      amountReceivedCents: 53625,
      currency: "usd",
      metadata: SLOT_METADATA,
    });
    const { deps, soldOut } = makeDeps(repo, payments);

    const out = await confirmBookingByPaymentIntent(deps, "pi_loser");

    // Assert we actually REACHED the residual-race branch. Without this the test passes just as
    // well when the claim never ran at all — the exact shape of green that proves nothing.
    expect(outcomeOf(out)).toBe("lost");
    expect(soldOut).not.toHaveBeenCalled();
    expect(payments.refunds).toHaveLength(0);
  });

  it("does NOT book the metadata-less intent behind a hosted balance checkout", async () => {
    const repo = await seeded();
    await repo.saveEvent(musterEvent());
    const payments = new FakePaymentPort();
    // The success page is also the hosted-checkout successUrl for the balance flow. Every hosted
    // session has an underlying PaymentIntent that succeeds and carries NO metadata, because the
    // adapter never sets `payment_intent_data.metadata` (DEC-134's double-write guard). Booking
    // from that would sell a second reservation for a balance top-up.
    payments.succeededIntents.set("pi_balance", {
      paymentIntentId: "pi_balance",
      amountReceivedCents: 10000,
      currency: "usd",
      metadata: {},
    });
    const { deps } = makeDeps(repo, payments);

    const out = await confirmBookingByPaymentIntent(deps, "pi_balance");

    expect(outcomeOf(out)).not.toBe("booked");
    expect(await repo.listAllReservations()).toHaveLength(0);
  });
});
