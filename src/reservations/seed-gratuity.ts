/**
 * Pure builder for the `db:seed:gratuity` dev fixture (12.3b) — produces a COMPLETE,
 * self-contained "completed crewed trip with a tip" so the Gusto tip report renders a real
 * split. Earlier this seed hung a gratuity on whatever shift already existed in the DB; that
 * grabbed future-dated at-risk trips the payroll won't credit and reported a false success.
 * Now it builds its own world (vessel → crewed shift + Confirmed seats → event → booked
 * reservation → pre gratuity), all on a caller-supplied date so the caller can place it inside
 * the current pay period. The runnable script (`db/seed-gratuity-dev.ts`) then VERIFIES the
 * split against `buildGratuityPayroll` before declaring anything.
 *
 * Side-effect-free (no repo, no clock) so the match test exercises it against the in-memory
 * repo. Deterministic ids keyed on date+seq ⇒ idempotent re-seed.
 */
import type { Event, Gratuity, Reservation, Seat, Shift, Vessel } from "../domain/entities.js";
import { asId } from "../domain/ids.js";

export interface SeedGratuityCrew {
  id: string;
  /** The seat role to confirm them into. Payroll ignores role identity, but it must be a
   *  valid RoleTypeId value — pass the crew's own rating where you have it. */
  role?: string;
}

export interface SeedGratuityInput {
  /** The crew who worked the trip — the split denominator. At least one. */
  crew: readonly SeedGratuityCrew[];
  /** ISO day (YYYY-MM-DD) for the trip — place it in the target pay period. */
  date: string;
  /** Integer cents to collect as a pre-trip gratuity. */
  amountCents: number;
  /** Tier basis points, provenance only. */
  bps?: number;
  /** ISO-8601 UTC, injected (keeps the builder deterministic + clock-free). */
  createdAt: string;
  /** Distinguishes multiple seeds on one date; keeps ids deterministic. Default 0. */
  seq?: number;
}

export interface SeededGratuityWorld {
  vessel: Vessel;
  shift: Shift;
  seats: Seat[];
  event: Event;
  reservation: Reservation;
  gratuity: Gratuity;
}

const DEFAULT_ROLE = "role-captain";

/**
 * Build a full crewed vessel-day carrying one booked reservation + a pre gratuity. Everything
 * is deterministic on `date`+`seq`, so re-running upserts rather than piling up money.
 */
export function buildSeededGratuity(input: SeedGratuityInput): SeededGratuityWorld {
  if (input.crew.length === 0) throw new Error("seed-gratuity: need at least one crew member to split among");
  const seq = input.seq ?? 0;
  const tag = `${input.date}-${seq}`;

  const vesselId = asId<"VesselId">(`vessel-tip-demo`);
  const eventId = asId<"EventId">(`evt-tip-${tag}`);
  const shiftId = asId<"ShiftId">(`shift-tip-${tag}`);
  const reservationId = asId<"ReservationId">(`resv-tip-${tag}`);
  const gratuityId = asId<"GratuityId">(`grat_pre_tip_${reservationId}`);

  const vessel: Vessel = {
    id: vesselId,
    name: "Tip Demo",
    coiMaxPax: 12,
    manning: [{ roleTypeId: asId<"RoleTypeId">(DEFAULT_ROLE), count: input.crew.length }],
  };

  const event: Event = {
    id: eventId,
    vesselId,
    date: input.date,
    time: "17:00",
    capacity: 12,
    status: "scheduled",
    source: "muster",
    price: 50000,
  };

  const shift: Shift = {
    id: shiftId,
    vesselId,
    date: input.date,
    state: "Crewed",
    eventIds: [eventId],
  };

  const seats: Seat[] = input.crew.map((c, i) => ({
    id: asId<"SeatId">(`seat-tip-${tag}-${i}`),
    shiftId,
    role: asId<"RoleTypeId">(c.role ?? DEFAULT_ROLE),
    kind: "required",
    state: "Confirmed",
    assignedCrewMemberId: asId<"CrewMemberId">(c.id),
  }));

  const reservation: Reservation = {
    id: reservationId,
    eventId,
    source: "muster",
    customerName: "Seed Tipper",
    partySize: 2,
    email: "seed-tipper@example.com",
    status: "booked",
    updatedAt: input.createdAt,
  };

  const gratuity: Gratuity = {
    id: gratuityId,
    eventId,
    reservationId,
    kind: "pre",
    amountCents: input.amountCents,
    ...(input.bps !== undefined ? { bps: input.bps } : {}),
    createdAt: input.createdAt,
  };

  return { vessel, shift, seats, event, reservation, gratuity };
}
