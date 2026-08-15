/**
 * In-memory repository adapter (DEC-013).
 *
 * Throwaway-thin: backs every aggregate with a Map and the reliability log with
 * an array. Stored values are cloned on the way in and out so a caller can't
 * mutate the store by holding a reference — the one invariant a real DB gives
 * for free that an in-memory store does not. Good enough to drive M0–M3 tests;
 * discarded when a durable adapter lands.
 */

import type {
  AddOn,
  Customer,
  Admin,
  Ask,
  AuthSubjectKind,
  Block,
  BookingCode,
  CheckoutHold,
  Credential,
  CrewMember,
  CrewStatus,
  Event,
  Gratuity,
  GustoIdentity,
  Location,
  LoginCode,
  CalendarFeed,
  Offering,
  Payment,
  MagicToken,
  OutboxEntry,
  RingOutboxEntry,
  NoticeOutboxEntry,
  SmsConsent,
  GuestContact,
  PtoWindow,
  TimePunch,
  TimePunchEdit,
  Reservation,
  RoleType,
  Seat,
  Shift,
  Subject,
  Vessel,
} from "../domain/entities.js";
import { subjectKey } from "../domain/subject.js";
import type {
  AddOnId,
  CustomerId,
  AskId,
  BlockId,
  CheckoutHoldId,
  GratuityId,
  CredentialId,
  CrewMemberId,
  EventId,
  LocationId,
  MagicTokenId,
  OfferingId,
  OutboxEntryId,
  RingOutboxEntryId,
  NoticeOutboxEntryId,
  PaymentId,
  PtoWindowId,
  TimePunchId,
  TimePunchEditId,
  ReservationId,
  RoleTypeId,
  SeatId,
  ShiftId,
  TenantId,
  VesselId,
} from "../domain/ids.js";
import type { ReliabilityEvent } from "../domain/reliability.js";
import type { AuditEvent } from "../domain/audit.js";
import type { SeatState } from "../domain/states.js";
import type { ImportRun, ImportRunItem } from "../import/import-audit.js";
import type { ImportRunId } from "../domain/ids.js";
import type { Message, Participant, Thread } from "../messaging/entities.js";
import type { MessageId, ParticipantId, ThreadId } from "../domain/ids.js";
import {
  PAYMENT_CONFIG_DEFAULTS,
  type PaymentConfig,
} from "../reservations/payment-config.js";
import { slotIdentity } from "../reservations/availability.js";
import {
  XOLA_TRIP_MINUTES,
  busyIntervalsFor,
  hullIsBusy,
  minutesOfDay,
} from "../reservations/hull-busy.js";
import type { FailureWindow, Repository } from "../ports/repository.js";

const clone = <T>(value: T): T => structuredClone(value);

/** Upsert `subjectKey → at` into a threadId→(subjectKey→ISO) store (latest-wins). */
const upsertThreadState = (
  store: Map<string, Map<string, string>>,
  threadId: ThreadId,
  subject: Subject,
  at: string,
): void => {
  const key = String(threadId);
  const inner = store.get(key) ?? new Map<string, string>();
  inner.set(subjectKey(subject), at);
  store.set(key, inner);
};

export class InMemoryRepository implements Repository {
  readonly #roleTypes = new Map<RoleTypeId, RoleType>();
  readonly #addOns = new Map<AddOnId, AddOn>();
  readonly #customers = new Map<CustomerId, Customer>();
  readonly #bookingCodes = new Map<string, BookingCode>();
  readonly #vessels = new Map<VesselId, Vessel>();
  readonly #crew = new Map<CrewMemberId, CrewMember>();
  readonly #credentials = new Map<CredentialId, Credential>();
  readonly #ptoWindows = new Map<PtoWindowId, PtoWindow>();
  readonly #timePunches = new Map<TimePunchId, TimePunch>();
  readonly #timePunchEdits: TimePunchEdit[] = [];
  readonly #events = new Map<EventId, Event>();
  readonly #reservations = new Map<ReservationId, Reservation>();
  /** Reservation catalog (DEC-123/125) — read-only surface in 12.0; writes 12.8–12.10. */
  readonly #offerings = new Map<OfferingId, Offering>();
  readonly #locations = new Map<LocationId, Location>();
  readonly #blocks = new Map<BlockId, Block>();
  /** Transient checkout-holds (12.1, DEC-109), keyed by id. */
  readonly #checkoutHolds = new Map<CheckoutHoldId, CheckoutHold>();
  /** Recovery throttle (issue #460): canonical contact key → ISO cooldown expiry. */
  readonly #recoveryThrottle = new Map<string, string>();
  /** Collected gratuities (12.3, DEC-124), keyed by id. */
  readonly #gratuities = new Map<GratuityId, Gratuity>();
  /** Muster-native payments (DEC-107), keyed by id. */
  readonly #payments = new Map<PaymentId, Payment>();
  /** Payment-config overrides (DEC-107); absent fields fall to PAYMENT_CONFIG_DEFAULTS. */
  #paymentConfig: Partial<PaymentConfig> = {};
  readonly #shifts = new Map<ShiftId, Shift>();
  readonly #seats = new Map<SeatId, Seat>();
  readonly #asks = new Map<AskId, Ask>();
  readonly #magicTokens = new Map<MagicTokenId, MagicToken>();
  readonly #admins = new Map<string, Admin>();
  readonly #loginCodes = new Map<string, LoginCode>();
  readonly #calendarFeeds = new Map<string, CalendarFeed>();
  readonly #outbox = new Map<OutboxEntryId, OutboxEntry>();
  readonly #ringOutbox = new Map<RingOutboxEntryId, RingOutboxEntry>();
  readonly #noticeOutbox = new Map<NoticeOutboxEntryId, NoticeOutboxEntry>();
  readonly #reliability: ReliabilityEvent[] = [];
  readonly #auditEvents: AuditEvent[] = [];
  readonly #smsConsent: SmsConsent[] = [];
  // Guest contacts (#345 Part B) — keyed by reservationId, upsert-latest.
  readonly #guestContacts = new Map<string, GuestContact>();
  // Engine pause flag (#124, DEC-054). Default false = running, mirroring the
  // KV's "absent row ⇒ running" semantics. `#enginePausedAt` mirrors the DB's
  // audit column (no read path through the port — parity, not a feature).
  #enginePaused = false;
  #enginePausedAt: string | null = null;
  // Self-claim confirm-gate flag (DEC-075). Default false = auto-lock, mirroring
  // the KV's "absent row ⇒ false" semantics. `#selfClaimAt` mirrors the audit col.
  #selfClaimRequiresConfirmation = false;
  #selfClaimAt: string | null = null;
  readonly #importRuns = new Map<
    ImportRunId,
    { run: ImportRun; items: ImportRunItem[] }
  >();
  readonly #threads = new Map<ThreadId, Thread>();
  readonly #participants = new Map<ParticipantId, Participant>();
  readonly #messages = new Map<MessageId, Message>();
  // Doorbell read / notify state (6.6a, DEC-069): threadId → (subjectKey → ISO).
  // Two single-writer stores, mirroring the two Postgres tables.
  readonly #reads = new Map<string, Map<string, string>>();
  readonly #notifies = new Map<string, Map<string, string>>();

  // ── Role types (tenant config — DEC-ROLE-1) ───────────────────────────────
  async saveRoleType(roleType: RoleType): Promise<void> {
    this.#roleTypes.set(roleType.id, clone(roleType));
  }
  async getRoleType(id: RoleTypeId): Promise<RoleType | null> {
    const r = this.#roleTypes.get(id);
    return r ? clone(r) : null;
  }
  async listRoleTypes(tenantId: TenantId): Promise<RoleType[]> {
    return [...this.#roleTypes.values()]
      .filter((r) => r.tenantId === tenantId)
      .map(clone);
  }
  async listAllRoleTypes(): Promise<RoleType[]> {
    return [...this.#roleTypes.values()].map(clone);
  }

  // ── Add-ons (first-class sellable extras — #491) ───────────────────────────
  async saveAddOn(addOn: AddOn): Promise<void> {
    this.#addOns.set(addOn.id, clone(addOn));
  }
  async getAddOn(id: AddOnId): Promise<AddOn | null> {
    const a = this.#addOns.get(id);
    return a ? clone(a) : null;
  }
  async listAddOns(): Promise<AddOn[]> {
    return [...this.#addOns.values()].map(clone);
  }

  // ── Customers (contact records — 12.12b, DEC-132) ──────────────────────────
  // The double stays DUMB: it does NOT enforce the phone/display-code UNIQUE indexes the
  // Postgres schema carries, and it holds no FK on `reservation.customerId`. That asymmetry is
  // deliberate (DEC-131) — reimplementing constraint checking here would put integrity in two
  // places, which is the exact smear the service-layer boundary exists to avoid. The adapters
  // diverge only on INVALID writes; the contract suite proves parity over valid operations.
  // The one exception is `getOrCreateCustomerByPhone`, whose RESULT is semantic: callers branch
  // on `created`, so both adapters must agree on which branch wins. Here a phone scan settles
  // it; in Postgres the unique index does.
  async saveCustomer(customer: Customer): Promise<void> {
    this.#customers.set(customer.id, clone(customer));
  }
  async getCustomer(id: CustomerId): Promise<Customer | null> {
    const c = this.#customers.get(id);
    return c ? clone(c) : null;
  }
  async getCustomerByPhone(phoneE164: string): Promise<Customer | null> {
    const c = [...this.#customers.values()].find((x) => x.phoneE164 === phoneE164);
    return c ? clone(c) : null;
  }
  async getCustomerByCode(displayCode: string): Promise<Customer | null> {
    const c = [...this.#customers.values()].find((x) => x.displayCode === displayCode);
    return c ? clone(c) : null;
  }
  async listCustomers(): Promise<Customer[]> {
    return [...this.#customers.values()].map(clone);
  }
  async getOrCreateCustomerByPhone(
    candidate: Customer,
  ): Promise<{ customer: Customer; created: boolean }> {
    const existing = [...this.#customers.values()].find(
      (x) => x.phoneE164 === candidate.phoneE164,
    );
    if (existing) return { customer: clone(existing), created: false };
    this.#customers.set(candidate.id, clone(candidate));
    return { customer: clone(candidate), created: true };
  }
  async listReservationsForCustomer(id: CustomerId): Promise<Reservation[]> {
    return [...this.#reservations.values()]
      .filter((r) => r.customerId === id)
      .map(clone);
  }

  // ── Booking codes (#741, DEC-154) ─────────────────────────────────────────
  // The duplicate-code THROW is enforced here, unlike the phone/display-code UNIQUE indexes
  // above which the double deliberately ignores. Same reason as `getOrCreateCustomerByPhone`:
  // the behaviour is semantic, not just integrity. `ensureBookingCode` catches this exact throw
  // to retry with a fresh mint, so a double that silently overwrote would make the retry loop
  // untestable here and would hand one customer's live link to another booking.
  async saveBookingCode(row: BookingCode): Promise<void> {
    if (this.#bookingCodes.has(row.code)) {
      throw new Error(`duplicate key value violates unique constraint "booking_codes_pkey"`);
    }
    this.#bookingCodes.set(row.code, clone(row));
  }
  async getBookingCode(code: string): Promise<BookingCode | null> {
    const row = this.#bookingCodes.get(code);
    return row ? clone(row) : null;
  }
  async listBookingCodesForReservation(id: ReservationId): Promise<BookingCode[]> {
    return [...this.#bookingCodes.values()]
      .filter((c) => c.reservationId === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }
  async revokeBookingCode(code: string, atIso: string): Promise<void> {
    const row = this.#bookingCodes.get(code);
    // Already revoked ⇒ keep the FIRST stamp. Re-stamping would rewrite when the link actually
    // died, which is the one fact a "why can't I open my link" conversation turns on.
    if (!row || row.revokedAt) return;
    this.#bookingCodes.set(code, { ...clone(row), revokedAt: atIso });
  }

  // ── Vessels ──────────────────────────────────────────────────────────────
  async saveVessel(vessel: Vessel): Promise<void> {
    this.#vessels.set(vessel.id, clone(vessel));
  }
  async getVessel(id: VesselId): Promise<Vessel | null> {
    const v = this.#vessels.get(id);
    return v ? clone(v) : null;
  }
  async listVessels(): Promise<Vessel[]> {
    return [...this.#vessels.values()].map(clone);
  }

  // ── Crew ───────────────────────────────────────────────────────────────────
  async saveCrewMember(crew: CrewMember): Promise<void> {
    this.#crew.set(crew.id, clone(crew));
  }
  async getCrewMember(id: CrewMemberId): Promise<CrewMember | null> {
    const c = this.#crew.get(id);
    return c ? clone(c) : null;
  }
  async updateCrewContact(
    id: CrewMemberId,
    fields: { name?: string; phone?: string; email?: string | null },
  ): Promise<CrewMember | null> {
    const c = this.#crew.get(id);
    if (!c) return null;
    // Mutate only the passed fields — mirrors the targeted UPDATE (DEC-094): a
    // whole-entity overwrite would drop concurrent reliability/status changes.
    if (fields.name !== undefined) c.name = fields.name;
    if (fields.phone !== undefined) c.phone = fields.phone;
    if (fields.email !== undefined) {
      if (fields.email === null) delete c.email;
      else c.email = fields.email;
    }
    return clone(c);
  }
  async setCrewStatus(id: CrewMemberId, status: CrewStatus): Promise<CrewMember | null> {
    const c = this.#crew.get(id);
    if (!c) return null;
    c.status = status;
    return clone(c);
  }
  async updateCrewWeekdaysOff(
    id: CrewMemberId,
    weekdaysOff: number[],
  ): Promise<CrewMember | null> {
    const c = this.#crew.get(id);
    if (!c) return null;
    // Targeted mutation (DEC-094): only weekdaysOff, so a concurrent engine write
    // to reliability/status isn't clobbered. Empty ⇒ omit (parity with postgres,
    // which reads the []-default column back as absent).
    if (weekdaysOff.length === 0) delete c.weekdaysOff;
    else c.weekdaysOff = [...weekdaysOff];
    return clone(c);
  }
  async updateCrewGusto(
    id: CrewMemberId,
    gusto: GustoIdentity,
  ): Promise<CrewMember | null> {
    const c = this.#crew.get(id);
    if (!c) return null;
    c.gusto = { ...gusto }; // targeted mutation (DEC-094) — only the gusto field
    return clone(c);
  }
  async addCrewMemberWithCredential(m: CrewMember, cred: Credential): Promise<void> {
    // In-memory can't partially fail, but keep the both-or-neither contract.
    this.#crew.set(m.id, clone(m));
    this.#credentials.set(cred.id, clone(cred));
  }
  async listCrewMembers(): Promise<CrewMember[]> {
    return [...this.#crew.values()].map(clone);
  }

  // ── Credentials (1:n per crew member — SPEC §2.1) ──────────────────────────
  async saveCredential(credential: Credential): Promise<void> {
    this.#credentials.set(credential.id, clone(credential));
  }
  async getCredential(id: CredentialId): Promise<Credential | null> {
    const c = this.#credentials.get(id);
    return c ? clone(c) : null;
  }
  async listCredentialsForCrew(
    crewMemberId: CrewMemberId,
  ): Promise<Credential[]> {
    return [...this.#credentials.values()]
      .filter((c) => c.crewMemberId === crewMemberId)
      .map(clone);
  }
  async listAllCredentials(): Promise<Credential[]> {
    return [...this.#credentials.values()].map(clone);
  }
  async removeCredential(id: CredentialId): Promise<void> {
    this.#credentials.delete(id);
  }

  // ── PTO windows (suppression-only — DEC-009) ───────────────────────────────
  async savePtoWindow(window: PtoWindow): Promise<void> {
    this.#ptoWindows.set(window.id, clone(window));
  }
  async listPtoWindowsForCrew(
    crewMemberId: CrewMemberId,
  ): Promise<PtoWindow[]> {
    return [...this.#ptoWindows.values()]
      .filter((w) => w.crewMemberId === crewMemberId)
      .map(clone);
  }
  async listAllPtoWindows(): Promise<PtoWindow[]> {
    return [...this.#ptoWindows.values()].map(clone);
  }
  async removePtoWindow(id: PtoWindowId): Promise<void> {
    this.#ptoWindows.delete(id);
  }

  // ── Time punches (SPEC §2.9) ───────────────────────────────────────────────
  async saveTimePunch(punch: TimePunch): Promise<void> {
    // Deliberately does NOT enforce the one-open-punch partial unique index — the
    // double stays dumb about constraints (see the Customers note above, DEC-131):
    // integrity lives in the schema, and mirroring it here would put it in two
    // places. `clockIn`'s check is what makes the use case deterministic on both
    // adapters; the index is what survives a real concurrent tap on Postgres.
    this.#timePunches.set(punch.id, clone(punch));
  }
  async getTimePunch(id: TimePunchId): Promise<TimePunch | null> {
    const p = this.#timePunches.get(id);
    return p ? clone(p) : null;
  }
  async getOpenPunchForCrew(crewMemberId: CrewMemberId): Promise<TimePunch | null> {
    const open = [...this.#timePunches.values()].find(
      (p) => p.crewMemberId === crewMemberId && p.outAt === null,
    );
    return open ? clone(open) : null;
  }
  async listTimePunchesForCrew(crewMemberId: CrewMemberId): Promise<TimePunch[]> {
    return [...this.#timePunches.values()]
      .filter((p) => p.crewMemberId === crewMemberId)
      .sort((a, b) => b.inAt.localeCompare(a.inAt))
      .map(clone);
  }
  async listTimePunchesBetween(
    fromInstant: string,
    toInstant: string,
  ): Promise<TimePunch[]> {
    // Half-open [from, to) — see the port doc. ISO-8601 UTC strings compare
    // lexicographically iff they're the same shape, which `.toISOString()` guarantees.
    return [...this.#timePunches.values()]
      .filter((p) => p.inAt >= fromInstant && p.inAt < toInstant)
      .sort((a, b) => a.inAt.localeCompare(b.inAt))
      .map(clone);
  }
  async listAllTimePunches(): Promise<TimePunch[]> {
    return [...this.#timePunches.values()].map(clone);
  }
  async removeTimePunch(id: TimePunchId): Promise<void> {
    this.#timePunches.delete(id);
  }

  // ── Time-punch edit trail (#635) ───────────────────────────────────────────
  // An array, not a Map — append-only, and the `reliability_events` precedent.
  async appendTimePunchEdit(edit: TimePunchEdit): Promise<void> {
    this.#timePunchEdits.push(clone(edit));
  }
  async listTimePunchEdits(timePunchId: TimePunchId): Promise<TimePunchEdit[]> {
    return this.#timePunchEdits
      .filter((e) => e.timePunchId === timePunchId)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map(clone);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  async saveEvent(event: Event): Promise<void> {
    this.#events.set(event.id, clone(event));
  }
  async getEvent(id: EventId): Promise<Event | null> {
    const e = this.#events.get(id);
    return e ? clone(e) : null;
  }
  async listEvents(): Promise<Event[]> {
    return [...this.#events.values()].map(clone);
  }
  async cancelEventIfUnclaimed(id: EventId): Promise<boolean> {
    // Single-threaded JS ⇒ trivially atomic; the Postgres adapter enforces the same under real
    // concurrency (row lock + the hull-day advisory lock `saveBookingIfSlotFree` also takes).
    const event = this.#events.get(id);
    if (!event || event.source !== "muster" || event.status !== "scheduled") return false;
    const claimed = [...this.#reservations.values()].some(
      (r) => r.eventId === id && r.source === "muster" && r.status === "booked",
    );
    if (claimed) return false;
    this.#events.set(id, { ...clone(event), status: "cancelled" });
    return true;
  }

  // ── Reservation catalog (DEC-123/125) ───────────────────────────────────────
  async listOfferings(): Promise<Offering[]> {
    return [...this.#offerings.values()].map(clone);
  }
  async getOffering(id: OfferingId): Promise<Offering | null> {
    const o = this.#offerings.get(id);
    return o ? clone(o) : null;
  }
  async saveOffering(offering: Offering): Promise<void> {
    this.#offerings.set(offering.id, clone(offering));
  }
  async listLocations(): Promise<Location[]> {
    return [...this.#locations.values()].map(clone);
  }
  async getLocation(id: LocationId): Promise<Location | null> {
    const l = this.#locations.get(id);
    return l ? clone(l) : null;
  }
  async saveLocation(location: Location): Promise<void> {
    this.#locations.set(location.id, clone(location));
  }
  async listBlocks(): Promise<Block[]> {
    return [...this.#blocks.values()].map(clone);
  }
  async saveBlock(block: Block): Promise<void> {
    this.#blocks.set(block.id, clone(block));
  }
  async removeBlock(id: BlockId): Promise<void> {
    this.#blocks.delete(id);
  }

  // ── Coexistence partition — Muster-owned vessel-days (DEC-106) ───────────────
  // ── Payments (DEC-107) ──────────────────────────────────────────────────────
  async getPaymentConfig(): Promise<PaymentConfig> {
    return { ...PAYMENT_CONFIG_DEFAULTS, ...this.#paymentConfig };
  }
  async setPaymentConfig(patch: Partial<PaymentConfig>, _at: string): Promise<void> {
    this.#paymentConfig = { ...this.#paymentConfig, ...patch };
  }
  async savePayment(payment: Payment): Promise<void> {
    // Insert-only (mirrors the postgres `on conflict do nothing`): a payment row is
    // immutable once written, so a re-delivered webhook is a no-op, not an overwrite.
    if (!this.#payments.has(payment.id)) this.#payments.set(payment.id, clone(payment));
  }
  async getPayment(id: PaymentId): Promise<Payment | null> {
    const p = this.#payments.get(id);
    return p ? clone(p) : null;
  }
  async listAllPayments(): Promise<Payment[]> {
    return [...this.#payments.values()].map(clone);
  }
  async getPaymentByIntentId(stripePaymentIntentId: string): Promise<Payment | null> {
    const p = [...this.#payments.values()].find(
      (x) => x.stripePaymentIntentId === stripePaymentIntentId,
    );
    return p ? clone(p) : null;
  }
  async markPaymentRefunded(id: PaymentId, refundedTotalCents: number): Promise<void> {
    // Mirrors the postgres `greatest(coalesce(...))`: idempotent on redelivery, accumulating
    // across partial refunds, and the status derived from the row's own amount.
    const p = this.#payments.get(id);
    if (!p) return;
    const total = Math.max(p.refundedCents ?? 0, refundedTotalCents);
    this.#payments.set(id, {
      ...clone(p),
      refundedCents: total,
      status: total >= p.amountCents ? "refunded" : "partially_refunded",
    });
  }
  async listPaymentsForReservation(reservationId: ReservationId): Promise<Payment[]> {
    return [...this.#payments.values()]
      .filter((p) => p.reservationId === reservationId)
      .map(clone);
  }

  // ── Reservations ───────────────────────────────────────────────────────────
  async saveReservation(reservation: Reservation): Promise<void> {
    this.#reservations.set(reservation.id, clone(reservation));
  }
  async getReservation(id: ReservationId): Promise<Reservation | null> {
    const r = this.#reservations.get(id);
    return r ? clone(r) : null;
  }
  async listReservationsForEvent(eventId: EventId): Promise<Reservation[]> {
    return [...this.#reservations.values()]
      .filter((r) => r.eventId === eventId)
      .map(clone);
  }
  async listAllReservations(): Promise<Reservation[]> {
    return [...this.#reservations.values()].map(clone);
  }

  async saveBookingIfSlotFree(
    event: Event,
    reservation: Reservation,
  ): Promise<{ result: "won"; eventId: EventId } | { result: "lost" }> {
    // Single-threaded JS ⇒ trivially atomic; the Postgres adapter enforces the same under
    // real concurrency (advisory lock on the hull-day + row lock). (0) the HULL must be free
    // over this departure — any other scheduled trip, either source, at an overlapping time
    // (#615, #691). This precedes materialization: losing here must not leave an event row
    // behind. (1) find-or-materialize the Muster Event at this slot identity — one row per
    // physical boat-slot (DEC-125 guardrail).
    const slotKey = slotIdentity(event.vesselId, event.date, event.time);
    const busy = busyIntervalsFor(
      // Exempt only the MUSTER event at this exact slot — that is the slot being claimed
      // (a pre-existing override, or this very row). A Xola event at the same clock time is
      // a foreign occupant and must still block: exempting by time alone re-opens #615.
      [...this.#events.values()].filter(
        (e) =>
          !(e.source === "muster" && slotIdentity(e.vesselId, e.date, e.time) === slotKey),
      ),
      event.vesselId,
      event.date,
    );
    if (
      hullIsBusy(
        busy,
        minutesOfDay(event.time),
        event.durationMinutes ?? XOLA_TRIP_MINUTES,
      )
    ) {
      return { result: "lost" };
    }
    const key = slotKey;
    let existing = [...this.#events.values()].find(
      (e) =>
        e.source === "muster" &&
        e.status === "scheduled" &&
        slotIdentity(e.vesselId, e.date, e.time) === key,
    );
    if (!existing) {
      // RESURRECT a cancelled slot (#616), explicitly. Postgres has to do this because
      // `events_muster_slot_identity` is status-agnostic and a cancelled row keeps owning the
      // identity; here the same case used to be handled BY ACCIDENT, and only sometimes. The
      // `#events.set(event.id, …)` below happens to overwrite the cancelled row whenever the
      // candidate's deterministic `eventIdForSlot` id matches it — but a slot backed by an
      // operator OVERRIDE row carries a different id, so the old code left the cancelled
      // override in place and added a SECOND event at the same identity: a state the database
      // index makes impossible. Divergence between the double and production is precisely the
      // DEC-131 trap, so state the behaviour rather than inherit it from a Map key collision.
      //
      // Same field policy as the pg adapter: re-freeze capacity/price/duration from the new
      // candidate (this customer's quoted fare), leave `dock` alone.
      const cancelled = [...this.#events.values()].find(
        (e) =>
          e.source === "muster" &&
          e.status === "cancelled" &&
          slotIdentity(e.vesselId, e.date, e.time) === key,
      );
      if (cancelled) {
        // **Overwrite price and duration UNCONDITIONALLY, including to absent.** Postgres writes
        // `price = $5` / `duration_minutes = $6` from `?? null`, so a candidate with no duration
        // NULLS the resurrected row. Spreading only when defined — the obvious shape — instead
        // keeps the previous cancelled booking's duration, and `writeSlotBooking` genuinely omits
        // it whenever the offering carries no `tripLengthMinutes` (`write-booking.ts:117`). That
        // divergence is the DEC-131 trap this very method exists to close, one field narrower;
        // code review caught it here.
        const revived: Event = {
          ...clone(cancelled),
          status: "scheduled",
          capacity: event.capacity,
        };
        delete revived.price;
        delete revived.durationMinutes;
        if (event.price !== undefined) revived.price = event.price;
        if (event.durationMinutes !== undefined) revived.durationMinutes = event.durationMinutes;
        this.#events.set(revived.id, revived);
        existing = revived;
      } else {
        this.#events.set(event.id, clone(event));
        existing = event;
      }
    }
    const eventId = existing.id;
    // (2) whole-boat mutex against the actual event id — source-scoped, idempotent on id.
    const blocked = [...this.#reservations.values()].some(
      (r) =>
        r.eventId === eventId &&
        r.source === "muster" &&
        r.status === "booked" &&
        r.id !== reservation.id,
    );
    if (blocked) return { result: "lost" };
    this.#reservations.set(reservation.id, clone({ ...reservation, eventId }));
    return { result: "won", eventId };
  }

  // ── Checkout holds (12.1, DEC-109) ──────────────────────────────────────────
  // ── Recovery throttle (issue #460) ────────────────────────────────────────
  // Enforced by the double, unlike the uniques it deliberately ignores, because the RESULT is
  // semantic: the recovery action branches on `claimed` to decide whether to spend an SMS.
  async claimRecoverySend(
    contactKey: string,
    nowIso: string,
    cooldownUntilIso: string,
  ): Promise<{ claimed: boolean }> {
    // Sweep every expired row, matching the Postgres adapter — the table would otherwise grow
    // one row per novel contact, forever.
    for (const [key, until] of this.#recoveryThrottle) {
      if (until <= nowIso) this.#recoveryThrottle.delete(key);
    }
    const cooldownUntil = this.#recoveryThrottle.get(contactKey);
    // A dead window is not a block — otherwise a customer who tried once could never try again.
    if (cooldownUntil && cooldownUntil > nowIso) return { claimed: false };
    this.#recoveryThrottle.set(contactKey, cooldownUntilIso);
    return { claimed: true };
  }

  async acquireCheckoutHold(
    hold: CheckoutHold,
  ): Promise<{ acquired: true; hold: CheckoutHold } | { acquired: false }> {
    const key = slotIdentity(hold.vesselId, hold.date, hold.time);
    // Delete any EXPIRED hold for this identity first (so a stale row can't block a fresh
    // acquire); "now" = the incoming hold's createdAt — same reference the pg adapter uses,
    // keeping the two behaviorally identical under the contract.
    for (const [id, h] of this.#checkoutHolds) {
      if (
        h.source === "muster" &&
        slotIdentity(h.vesselId, h.date, h.time) === key &&
        h.expiresAt <= hold.createdAt
      ) {
        this.#checkoutHolds.delete(id);
      }
    }
    const live = [...this.#checkoutHolds.values()].find(
      (h) =>
        h.source === "muster" &&
        slotIdentity(h.vesselId, h.date, h.time) === key &&
        h.expiresAt > hold.createdAt,
    );
    if (live) {
      // A live hold holds the slot. Idempotent iff it's our own id; else the rival won.
      return live.id === hold.id
        ? { acquired: true, hold: clone(live) }
        : { acquired: false };
    }
    this.#checkoutHolds.set(hold.id, clone(hold));
    return { acquired: true, hold: clone(hold) };
  }
  async listCheckoutHolds(): Promise<CheckoutHold[]> {
    return [...this.#checkoutHolds.values()].map(clone);
  }
  async removeCheckoutHold(id: CheckoutHoldId): Promise<void> {
    this.#checkoutHolds.delete(id);
  }
  async removeCheckoutHoldForSlot(
    vesselId: VesselId,
    date: string,
    time: string,
  ): Promise<void> {
    const key = slotIdentity(vesselId, date, time);
    for (const [id, h] of this.#checkoutHolds) {
      if (h.source === "muster" && slotIdentity(h.vesselId, h.date, h.time) === key) {
        this.#checkoutHolds.delete(id);
      }
    }
  }

  // ── Gratuity (12.3, DEC-124) ────────────────────────────────────────────────
  async saveGratuity(gratuity: Gratuity): Promise<void> {
    this.#gratuities.set(gratuity.id, clone(gratuity)); // deterministic id ⇒ idempotent
  }
  async listGratuitiesForEvent(eventId: EventId): Promise<Gratuity[]> {
    return [...this.#gratuities.values()].filter((g) => g.eventId === eventId).map(clone);
  }
  async listAllGratuities(): Promise<Gratuity[]> {
    return [...this.#gratuities.values()].map(clone);
  }

  // ── Shifts ─────────────────────────────────────────────────────────────────
  async saveShift(shift: Shift): Promise<void> {
    this.#shifts.set(shift.id, clone(shift));
  }
  async getShift(id: ShiftId): Promise<Shift | null> {
    const s = this.#shifts.get(id);
    return s ? clone(s) : null;
  }
  async listShifts(): Promise<Shift[]> {
    return [...this.#shifts.values()].map(clone);
  }
  async removeShift(id: ShiftId): Promise<void> {
    this.#shifts.delete(id);
  }

  // ── Seats ──────────────────────────────────────────────────────────────────
  async saveSeat(seat: Seat): Promise<void> {
    this.#seats.set(seat.id, clone(seat));
  }
  async getSeat(id: SeatId): Promise<Seat | null> {
    const s = this.#seats.get(id);
    return s ? clone(s) : null;
  }
  async saveSeatIfState(seat: Seat, expectedState: SeatState): Promise<boolean> {
    // Single-threaded JS makes this trivially atomic here; the contract it
    // upholds is what matters — the Postgres adapter enforces the same CAS under
    // real concurrency (REQ-CLAIM-1, DEC-020).
    const current = this.#seats.get(seat.id);
    if (!current || current.state !== expectedState) return false;
    this.#seats.set(seat.id, clone(seat));
    return true;
  }
  async removeSeat(id: SeatId): Promise<void> {
    this.#seats.delete(id);
  }
  async listSeatsForShift(shiftId: ShiftId): Promise<Seat[]> {
    return [...this.#seats.values()]
      .filter((s) => s.shiftId === shiftId)
      .map(clone);
  }
  async listAllSeats(): Promise<Seat[]> {
    return [...this.#seats.values()].map(clone);
  }

  // ── Asks ───────────────────────────────────────────────────────────────────
  async saveAsk(ask: Ask): Promise<void> {
    this.#asks.set(ask.id, clone(ask));
  }
  async getAsk(id: AskId): Promise<Ask | null> {
    const a = this.#asks.get(id);
    return a ? clone(a) : null;
  }
  async listAsksForSeat(seatId: SeatId): Promise<Ask[]> {
    return [...this.#asks.values()]
      .filter((a) => a.seatId === seatId)
      .map(clone);
  }
  async listAllAsks(): Promise<Ask[]> {
    return [...this.#asks.values()].map(clone);
  }
  async removeAsk(id: AskId): Promise<void> {
    this.#asks.delete(id);
  }

  // ── Magic-link tokens (self-rolled auth — DEC-010, DEC-020) ────────────────
  async saveMagicToken(token: MagicToken): Promise<void> {
    this.#magicTokens.set(token.id, clone(token));
  }
  async getMagicTokenByHash(tokenHash: string): Promise<MagicToken | null> {
    const t = [...this.#magicTokens.values()].find(
      (x) => x.tokenHash === tokenHash,
    );
    return t ? clone(t) : null;
  }
  async consumeMagicTokenIfUnused(
    tokenHash: string,
    consumedAt: string,
  ): Promise<boolean> {
    // Single-threaded JS makes this atomic here; the contract it upholds is what
    // matters — Postgres enforces the same single-use CAS under real concurrency.
    const current = [...this.#magicTokens.values()].find(
      (x) => x.tokenHash === tokenHash,
    );
    if (!current || current.consumedAt !== undefined) return false;
    this.#magicTokens.set(current.id, clone({ ...current, consumedAt }));
    return true;
  }
  async listAllMagicTokens(): Promise<MagicToken[]> {
    return [...this.#magicTokens.values()].map(clone);
  }
  async removeMagicToken(id: MagicTokenId): Promise<void> {
    this.#magicTokens.delete(id);
  }

  // ── Admins (auth identity + per-person revoke — DEC-092) ───────────────────
  async saveAdmin(admin: Admin): Promise<void> {
    this.#admins.set(admin.id, clone(admin));
  }
  async getAdmin(id: string): Promise<Admin | null> {
    const a = this.#admins.get(id);
    return a ? clone(a) : null;
  }
  async getAdminByHandle(handle: string): Promise<Admin | null> {
    const a = [...this.#admins.values()].find((x) => x.handle === handle);
    return a ? clone(a) : null;
  }
  async listAdmins(): Promise<Admin[]> {
    return [...this.#admins.values()].map(clone);
  }

  // ── Login codes (crew self-serve sign-in — DEC-081) ────────────────────────
  async saveLoginCode(c: LoginCode): Promise<void> {
    // Mirrors the postgres upsert: the re-mint replaces the code and resets `attempts`,
    // but CARRIES the failure window forward. Letting the mint clear it would restore the
    // mint-guess-mint loop DEC-142 exists to close, and the double has to hold the same
    // rule or the contract suite proves parity on a hole.
    const key = `${c.subjectKind}:${c.subjectId}`;
    const prior = this.#loginCodes.get(key);
    this.#loginCodes.set(
      key,
      clone({
        ...c,
        ...(prior?.failedSince !== undefined ? { failedSince: prior.failedSince } : {}),
        ...(prior?.failedInWindow !== undefined
          ? { failedInWindow: prior.failedInWindow }
          : {}),
      }),
    );
  }
  async getLoginCode(
    subjectKind: AuthSubjectKind,
    subjectId: string,
  ): Promise<LoginCode | null> {
    const c = this.#loginCodes.get(`${subjectKind}:${subjectId}`);
    return c ? clone(c) : null;
  }
  async consumeLoginCodeIfUnused(
    subjectKind: AuthSubjectKind,
    subjectId: string,
    consumedAt: string,
  ): Promise<boolean> {
    // Single-threaded JS makes this atomic; the contract — single-use CAS — is
    // what Postgres enforces under real concurrency.
    const key = `${subjectKind}:${subjectId}`;
    const current = this.#loginCodes.get(key);
    if (!current || current.consumedAt !== undefined) return false;
    this.#loginCodes.set(key, clone({ ...current, consumedAt }));
    return true;
  }
  async claimLoginAttempt(
    subjectKind: AuthSubjectKind,
    subjectId: string,
    maxAttempts: number,
    window: FailureWindow,
  ): Promise<{ codeHash: string; expiresAt: string; attempts: number } | null> {
    const key = `${subjectKind}:${subjectId}`;
    const current = this.#loginCodes.get(key);
    if (
      !current ||
      current.consumedAt !== undefined ||
      current.attempts >= maxAttempts
    ) {
      return null;
    }
    // Mirrors the postgres CTE (DEC-142): `stale` decided ONCE, then reused by the guard,
    // the new window start, and the reset-or-increment. String compare on ISO-8601 UTC is
    // ordering-correct, and it's what the SQL side does — a Date.parse here would be a
    // second implementation of the comparison, free to disagree at a boundary.
    const stale = current.failedSince === undefined || current.failedSince < window.startsAt;
    if (!stale && (current.failedInWindow ?? 0) >= window.max) return null;

    const attempts = current.attempts + 1;
    // A live window keeps its own `failedSince` — the spread already carries it, so it is
    // never rewritten here. Only a stale (or first-ever) window stamps a new start.
    const next: LoginCode = stale
      ? { ...current, attempts, failedSince: window.now, failedInWindow: 1 }
      : { ...current, attempts, failedInWindow: (current.failedInWindow ?? 0) + 1 };
    this.#loginCodes.set(key, clone(next));
    return { codeHash: current.codeHash, expiresAt: current.expiresAt, attempts };
  }

  // ── Calendar feeds (crew iCal subscription — #355, DEC-098) ────────────────
  async saveCalendarFeed(feed: CalendarFeed): Promise<void> {
    this.#calendarFeeds.set(String(feed.crewMemberId), clone(feed));
  }
  async getCalendarFeedByTokenHash(tokenHash: string): Promise<CalendarFeed | null> {
    const f = [...this.#calendarFeeds.values()].find(
      (x) => x.tokenHash === tokenHash,
    );
    return f ? clone(f) : null;
  }
  async getCalendarFeedForCrew(
    crewMemberId: CrewMemberId,
  ): Promise<CalendarFeed | null> {
    const f = this.#calendarFeeds.get(String(crewMemberId));
    return f ? clone(f) : null;
  }
  async deleteCalendarFeed(crewMemberId: CrewMemberId): Promise<void> {
    this.#calendarFeeds.delete(String(crewMemberId));
  }
  async touchCalendarFeedPoll(
    tokenHash: string,
    polledAt: string,
  ): Promise<void> {
    const entry = [...this.#calendarFeeds.entries()].find(
      ([, x]) => x.tokenHash === tokenHash,
    );
    if (entry) this.#calendarFeeds.set(entry[0], clone({ ...entry[1], lastPolledAt: polledAt }));
  }

  // ── Outbox entries (web-link channel adapter state — DEC-030) ──────────────
  async saveOutboxEntry(entry: OutboxEntry): Promise<void> {
    this.#outbox.set(entry.id, clone(entry));
  }
  async getOutboxEntry(id: OutboxEntryId): Promise<OutboxEntry | null> {
    const e = this.#outbox.get(id);
    return e ? clone(e) : null;
  }
  async listOutboxEntries(): Promise<OutboxEntry[]> {
    return [...this.#outbox.values()].map(clone);
  }
  async removeOutboxEntry(id: OutboxEntryId): Promise<void> {
    this.#outbox.delete(id);
  }

  // ── Ring outbox entries (doorbell-relay channel adapter state — DEC-073) ────
  async saveRingOutboxEntry(entry: RingOutboxEntry): Promise<void> {
    this.#ringOutbox.set(entry.id, clone(entry));
  }
  async getRingOutboxEntry(id: RingOutboxEntryId): Promise<RingOutboxEntry | null> {
    const e = this.#ringOutbox.get(id);
    return e ? clone(e) : null;
  }
  async listRingOutboxEntries(): Promise<RingOutboxEntry[]> {
    return [...this.#ringOutbox.values()].map(clone);
  }
  async removeRingOutboxEntry(id: RingOutboxEntryId): Promise<void> {
    this.#ringOutbox.delete(id);
  }

  // ── Notice outbox entries (assignment-change relay adapter state — DEC-084) ─
  async saveNoticeOutboxEntry(entry: NoticeOutboxEntry): Promise<void> {
    this.#noticeOutbox.set(entry.id, clone(entry));
  }
  async getNoticeOutboxEntry(id: NoticeOutboxEntryId): Promise<NoticeOutboxEntry | null> {
    const e = this.#noticeOutbox.get(id);
    return e ? clone(e) : null;
  }
  async listNoticeOutboxEntries(): Promise<NoticeOutboxEntry[]> {
    return [...this.#noticeOutbox.values()].map(clone);
  }
  async removeNoticeOutboxEntry(id: NoticeOutboxEntryId): Promise<void> {
    this.#noticeOutbox.delete(id);
  }

  // ── Reliability log (append-only — DEC-008) ───────────────────────────────
  async logReliabilityEvent(event: ReliabilityEvent): Promise<void> {
    this.#reliability.push(clone(event));
  }
  async reliabilityEventsFor(
    crewMemberId: CrewMemberId,
  ): Promise<ReliabilityEvent[]> {
    return this.#reliability
      .filter((e) => e.crewMemberId === crewMemberId)
      .map(clone);
  }
  async listAllReliabilityEvents(): Promise<ReliabilityEvent[]> {
    // Match pg's `order by timestamp desc, seq desc` exactly: reverse gives
    // insertion-desc (the seq-desc tiebreak), then a STABLE sort by timestamp
    // desc keeps that order within equal timestamps. Same shape on both adapters
    // so a direct caller isn't at the mercy of which repo it holds.
    return this.#reliability
      .map(clone)
      .reverse()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  // ── Crew audit log (append-only — #400, DEC-118) ──────────────────────────
  async appendAuditEvent(event: AuditEvent): Promise<void> {
    this.#auditEvents.push(clone(event));
  }
  async listAuditEvents(): Promise<AuditEvent[]> {
    // Same ordering contract as listAllReliabilityEvents / pg: timestamp desc,
    // insertion-desc tiebreak (stable sort over the reversed array).
    return this.#auditEvents
      .map(clone)
      .reverse()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async recordSmsConsent(consent: SmsConsent): Promise<void> {
    this.#smsConsent.push(clone(consent));
  }
  async listSmsConsentsForCrew(crewMemberId: CrewMemberId): Promise<SmsConsent[]> {
    return this.#smsConsent
      .filter((c) => c.crewMemberId === crewMemberId)
      .map(clone);
  }

  async recordGuestContact(contact: GuestContact): Promise<void> {
    this.#guestContacts.set(String(contact.reservationId), clone(contact));
  }
  async listGuestContactsForShift(shiftId: ShiftId): Promise<GuestContact[]> {
    return [...this.#guestContacts.values()]
      .filter((c) => c.shiftId === shiftId)
      .map(clone);
  }

  // ── Engine pause flag (operator control — #124, DEC-054) ───────────────────
  async isEnginePaused(): Promise<boolean> {
    return this.#enginePaused;
  }
  async setEnginePaused(paused: boolean, at: string): Promise<void> {
    this.#enginePaused = paused;
    this.#enginePausedAt = at;
  }

  // ── Self-claim confirm-gate flag (DEC-075) ─────────────────────────────────
  async selfClaimRequiresConfirmation(): Promise<boolean> {
    return this.#selfClaimRequiresConfirmation;
  }
  async setSelfClaimRequiresConfirmation(
    value: boolean,
    at: string,
  ): Promise<void> {
    this.#selfClaimRequiresConfirmation = value;
    this.#selfClaimAt = at;
  }

  // ── Import-run audit (#128) ────────────────────────────────────────────────
  async saveImportRun(run: ImportRun, items: ImportRunItem[]): Promise<void> {
    this.#importRuns.set(run.id, clone({ run, items }));
  }
  async getImportRun(
    id: ImportRunId,
  ): Promise<{ run: ImportRun; items: ImportRunItem[] } | null> {
    const r = this.#importRuns.get(id);
    return r ? clone(r) : null;
  }
  async listImportRuns(limit: number): Promise<ImportRun[]> {
    return [...this.#importRuns.values()]
      .map((e) => e.run)
      // newest first; id desc breaks ranAt ties deterministically so the order
      // matches the Postgres adapter's `order by ran_at desc, id desc` (parity).
      .sort(
        (a, b) =>
          b.ranAt.localeCompare(a.ranAt) ||
          String(b.id).localeCompare(String(a.id)),
      )
      .slice(0, limit)
      .map(clone);
  }

  // ── Messaging (threads / participants / messages — #111, DEC-051) ──────────
  async saveThread(thread: Thread): Promise<void> {
    this.#threads.set(thread.id, clone(thread));
  }
  async getThread(id: ThreadId): Promise<Thread | null> {
    const t = this.#threads.get(id);
    return t ? clone(t) : null;
  }
  async saveParticipant(participant: Participant): Promise<void> {
    this.#participants.set(participant.id, clone(participant));
  }
  async listParticipantsForThread(threadId: ThreadId): Promise<Participant[]> {
    return [...this.#participants.values()]
      .filter((p) => p.threadId === threadId)
      .map(clone);
  }
  async saveMessage(message: Message): Promise<void> {
    this.#messages.set(message.id, clone(message));
  }
  async listMessagesForThread(threadId: ThreadId): Promise<Message[]> {
    return [...this.#messages.values()]
      .filter((m) => m.threadId === threadId)
      // chronological; id break matches the pg adapter's `order by created_at, id`.
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .map(clone);
  }
  async listThreadsWithMessages(): Promise<Thread[]> {
    const withMsg = new Set(
      [...this.#messages.values()].map((m) => String(m.threadId)),
    );
    return [...this.#threads.values()]
      .filter((t) => withMsg.has(String(t.id)))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))) // parity: id-sorted
      .map(clone);
  }
  async listDmThreadsForCrew(crewMemberId: CrewMemberId): Promise<Thread[]> {
    const myThreadIds = new Set(
      [...this.#participants.values()]
        .filter((p) => String(p.crewMemberId) === String(crewMemberId))
        .map((p) => String(p.threadId)),
    );
    return [...this.#threads.values()]
      .filter((t) => t.kind === "dm" && myThreadIds.has(String(t.id)))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))) // parity: id-sorted
      .map(clone);
  }

  // ── Doorbell read / notify state (6.6a, #116, DEC-069) ─────────────────────
  // Thread-scoped, subjectKey-keyed — byte-identical to PostgresRepository (the
  // contract pins it). A fresh Map per read so callers can't mutate the store.
  async readStateForThread(threadId: ThreadId): Promise<Map<string, string>> {
    return new Map(this.#reads.get(String(threadId)) ?? []);
  }
  async notifyStateForThread(threadId: ThreadId): Promise<Map<string, string>> {
    return new Map(this.#notifies.get(String(threadId)) ?? []);
  }
  async recordRead(threadId: ThreadId, subject: Subject, at: string): Promise<void> {
    upsertThreadState(this.#reads, threadId, subject, at);
  }
  async recordNotification(threadId: ThreadId, subject: Subject, at: string): Promise<void> {
    upsertThreadState(this.#notifies, threadId, subject, at);
  }
}
