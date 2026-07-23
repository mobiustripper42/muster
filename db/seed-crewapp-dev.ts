/**
 * Dev seed for the Crew App (SPEC §2.6). Populates enough state to exercise the
 * crew surfaces by hand: one crew member ("crew-quint") with one CONFIRMED
 * upcoming shift (shows in my-shifts) and one OPEN ask (shows the In/Out card).
 *
 * Idempotent — every write is an upsert. Run against local dev Postgres:
 *   docker compose up -d && npm run db:migrate && npx tsx db/seed-crewapp-dev.ts
 * Then: GET /crew/dev-link?crew=crew-quint → tap the link → /crew.
 *
 * Dev tooling, not app code. Uses the same Postgres adapter the app runs on.
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { TENANT_TIMEZONE } from "../src/config/tenant.js";
import { asId } from "../src/domain/ids.js";
import {
  logAskAccepted,
  logAskIgnored,
  logAtRiskRescue,
  logEscalationAccepted,
  logNoShow,
  logShiftBailed,
  logShiftCompleted,
} from "../src/oracle/reliability-log.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

const TENANT = asId<"TenantId">("tenant-brewboat"); // match app TENANT_ID + canonical seeds
const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const VESSEL = asId<"VesselId">("vessel-hops");
const QUINT = asId<"CrewMemberId">("crew-quint");
const HOOPER = asId<"CrewMemberId">("crew-hooper");

// Near-future shift dates, anchored to NOW so the seed never rots (#101) — like
// seed-atrisk-dev. ~2 weeks out keeps shift-soon comfortably upcoming AND before
// its staffing horizon (7d lead), preserving the far-from-trip suppression demo.
// Vessel-local calendar day (DEC-032).
const at = (hours: number) => new Date(Date.now() + hours * 3600_000);
const dateOf = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TENANT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const SOON = dateOf(at(15 * 24));
const LATER = dateOf(at(16 * 24));

try {
  await repo.saveRoleType({ id: CAPTAIN, tenantId: TENANT, name: "captain" });
  await repo.saveRoleType({ id: MATE, tenantId: TENANT, name: "mate" });
  await repo.saveVessel({
    id: VESSEL,
    name: "Hops",
    coiMaxPax: 12,
    manning: [{ roleTypeId: CAPTAIN, count: 1 }, { roleTypeId: MATE, count: 1 }],
  });
  await repo.saveCrewMember({ id: QUINT, name: "Quint", email: "quint@bb.test", phone: "+15555550101", ratings: [CAPTAIN], status: "active", reliabilityScore: null });
  await repo.saveCrewMember({ id: HOOPER, name: "Hooper", email: "hooper@bb.test", phone: "+15555550102", ratings: [MATE], status: "active", reliabilityScore: null });
  // Quint's MMC expires ~30d from seed time (anchored to now so the #57 nudge
  // line always shows inside the 60d window); Hooper's is comfortably valid.
  const in30d = new Date(Date.now() + 30 * 24 * 3600_000).toISOString().slice(0, 10);
  await repo.saveCredential({ id: asId<"CredentialId">("cred-quint-mmc"), crewMemberId: QUINT, type: "MMC", expiry: in30d });
  await repo.saveCredential({ id: asId<"CredentialId">("cred-hooper-mmc"), crewMemberId: HOOPER, type: "MMC", expiry: "2027-12-31" });

  // Eric — REAL phone, for the Twilio live-SMS smoke (#242): MATE-rated (NOT
  // captain — bail-regression.spec depends on Quint being the only valid
  // captain) with a long MMC, so he lands in mate-seat ask pools; "Ask to
  // fill" on shift-open's mate seat texts his actual phone once the three
  // TWILIO_* vars are set. Dev seed only.
  const ERIC = asId<"CrewMemberId">("crew-eric");
  await repo.saveCrewMember({ id: ERIC, name: "Eric Stoffer", email: "eric@bb.test", phone: "+14403631599", ratings: [MATE], status: "active", reliabilityScore: null });
  await repo.saveCredential({ id: asId<"CredentialId">("cred-eric-mmc"), crewMemberId: ERIC, type: "MMC", expiry: "2030-12-31" });
  // …and an ADMIN, so a reset dev DB has a way in.
  //
  // NOTHING else creates one. Migration 0018 seeded a provisional roster and 0019 deliberately
  // deleted it again ("admins are CLI-managed, not seeded") — correctly, because an admin id is
  // a REAL crew id (DEC-092) and prod's real ids aren't knowable at migration-authoring time.
  // So on prod, admins arrive via `db:admin add --email=… --handle=…` after the roster exists.
  // In DEV that left a gap: the only admin was whatever the operator added by hand, and any
  // reset wiped it with nothing to restore it. Seeding one here closes that — the dev roster is
  // fixture data, so its crew ids ARE knowable, which is exactly what prod lacks.
  //
  // Sign in at /crew/dev-link?admin=eric, or via the crew code flow on eric@bb.test.
  await repo.saveAdmin({
    id: ERIC,
    handle: "eric",
    name: "Eric Stoffer",
    active: true,
    createdAt: new Date().toISOString(),
    deactivatedAt: null,
  });

  // A confirmed upcoming shift with two events (3pm + 5pm, different docks) →
  // my-shifts row → the shift card (call/departure times, dock pins, per-event
  // manifest, co-crew). Quint (captain) + Hooper (mate) both confirmed.
  const SHIFT_SOON = asId<"ShiftId">("shift-soon");
  const E3 = asId<"EventId">("evt-soon-3pm");
  const E5 = asId<"EventId">("evt-soon-5pm");
  await repo.saveShift({ id: SHIFT_SOON, vesselId: VESSEL, date: SOON, state: "Crewed", eventIds: [E3, E5] });
  await repo.saveEvent({ id: E3, vesselId: VESSEL, date: SOON, time: "15:00", capacity: 12, source: "xola", status: "scheduled", dock: "East Bank of the Flats at Canal Basin Park" });
  await repo.saveEvent({ id: E5, vesselId: VESSEL, date: SOON, time: "17:00", capacity: 12, source: "xola", status: "scheduled", dock: "East Bank of the Flats at Canal Basin Park" });
  await repo.saveSeat({ id: asId<"SeatId">("seat-soon-cap"), shiftId: SHIFT_SOON, role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: QUINT });
  await repo.saveSeat({ id: asId<"SeatId">("seat-soon-mate"), shiftId: SHIFT_SOON, role: MATE, kind: "required", state: "Confirmed", assignedCrewMemberId: HOOPER });
  // Accepted asks behind the two confirmed seats — the normal "they said In" path,
  // so the crew app doesn't mislabel them "Added for you" (#161: that badge is for an
  // operator force-place — a Confirmed seat with NO accepted ask by the occupant).
  const acceptedAt = new Date(Date.now() - 3600_000).toISOString();
  await repo.saveAsk({ id: asId<"AskId">("ask-soon-cap"), seatId: asId<"SeatId">("seat-soon-cap"), crewMemberId: QUINT, channel: "push", sentAt: acceptedAt, respondedAt: acceptedAt, response: "accepted" });
  await repo.saveAsk({ id: asId<"AskId">("ask-soon-mate"), seatId: asId<"SeatId">("seat-soon-mate"), crewMemberId: HOOPER, channel: "push", sentAt: acceptedAt, respondedAt: acceptedAt, response: "accepted" });

  // A SECOND boat out the SAME day as shift-soon (#315) — so the shift card's
  // "Other shifts today" has something to show. Its captain (Gilly) is seeded
  // UNRATED + already-Confirmed (a force-place): she never enters any ask pool,
  // so this doesn't disturb bail-regression's "Quint is the only captain"
  // assumption or Eric's mate availability. Different vessel, one 1pm trip.
  const GROWLER = asId<"VesselId">("vessel-growler");
  const GILLY = asId<"CrewMemberId">("crew-gilly");
  await repo.saveVessel({ id: GROWLER, name: "Growler", coiMaxPax: 12, manning: [{ roleTypeId: CAPTAIN, count: 1 }] });
  await repo.saveCrewMember({ id: GILLY, name: "Gilly", email: "gilly@bb.test", phone: "+15555550109", ratings: [], status: "active", reliabilityScore: null });
  const SHIFT_SOON_B = asId<"ShiftId">("shift-soon-growler");
  const EGB = asId<"EventId">("evt-soon-growler-1pm");
  const EGB2 = asId<"EventId">("evt-soon-growler-4pm");
  // Two trips (1pm + 4pm) so the "other shifts today" card shows "1:00 PM / 2 trips".
  await repo.saveShift({ id: SHIFT_SOON_B, vesselId: GROWLER, date: SOON, state: "Crewed", eventIds: [EGB, EGB2] });
  await repo.saveEvent({ id: EGB, vesselId: GROWLER, date: SOON, time: "13:00", capacity: 12, source: "xola", status: "scheduled", dock: "East Bank of the Flats at Canal Basin Park" });
  await repo.saveEvent({ id: EGB2, vesselId: GROWLER, date: SOON, time: "16:00", capacity: 12, source: "xola", status: "scheduled", dock: "East Bank of the Flats at Canal Basin Park" });
  await repo.saveSeat({ id: asId<"SeatId">("seat-soon-growler-cap"), shiftId: SHIFT_SOON_B, role: CAPTAIN, kind: "required", state: "Confirmed", assignedCrewMemberId: GILLY });
  // Reap seats this seed no longer writes (upserts never delete, and a renamed
  // seat id leaves a zombie row — e.g. a 3rd captain seat on a 2-crew boat that
  // hijacks the card's mySeatId and the bail demo).
  for (const s of await repo.listSeatsForShift(SHIFT_SOON)) {
    if (s.id !== "seat-soon-cap" && s.id !== "seat-soon-mate") {
      await repo.removeSeat(s.id);
    }
  }
  // Manifest: different guests on each event (the hinge).
  await repo.saveReservation({ id: asId<"ReservationId">("r-3pm-1"), eventId: E3, customerName: "Brody party", partySize: 4, source: "xola", phone: "+15555551111", status: "booked" });
  await repo.saveReservation({ id: asId<"ReservationId">("r-3pm-2"), eventId: E3, customerName: "Vaughn party", partySize: 6, source: "xola", status: "booked" });
  await repo.saveReservation({ id: asId<"ReservationId">("r-5pm-1"), eventId: E5, customerName: "Ellen party", partySize: 2, source: "xola", phone: "+15555552222", status: "booked" });

  // An open ask → the In/Out card on /crew.
  await repo.saveShift({ id: asId<"ShiftId">("shift-ask"), vesselId: VESSEL, date: LATER, state: "Filling", eventIds: [] });
  await repo.saveSeat({ id: asId<"SeatId">("seat-ask"), shiftId: asId<"ShiftId">("shift-ask"), role: CAPTAIN, kind: "required", state: "Asked" });
  await repo.saveAsk({ id: asId<"AskId">("ask-quint-1"), seatId: asId<"SeatId">("seat-ask"), crewMemberId: QUINT, channel: "push", sentAt: "2026-07-01T09:00:00.000Z" });

  // A self-claimable shift → the /crew/open pull surface (7.3). An OPEN required
  // captain seat (Quint's native role, DEC-076) on a Filling shift ~7d out — inside
  // the today+45d window AND before Quint's 30d MMC, on a date he's not already
  // committed (shift-soon is 15d out). Two scheduled trips (1pm & 4pm) drive the
  // DEC-077 confirm-sheet copy ("2 trips … call 12:30, back ~6").
  const OPEN = dateOf(at(7 * 24));
  const EO1 = asId<"EventId">("evt-open-1pm");
  const EO4 = asId<"EventId">("evt-open-4pm");
  await repo.saveShift({ id: asId<"ShiftId">("shift-open"), vesselId: VESSEL, date: OPEN, state: "Filling", eventIds: [EO1, EO4] });
  await repo.saveEvent({ id: EO1, vesselId: VESSEL, date: OPEN, time: "13:00", capacity: 12, source: "xola", status: "scheduled", dock: "East Bank of the Flats at Canal Basin Park" });
  await repo.saveEvent({ id: EO4, vesselId: VESSEL, date: OPEN, time: "16:00", capacity: 12, source: "xola", status: "scheduled", dock: "East Bank of the Flats at Canal Basin Park" });
  await repo.saveSeat({ id: asId<"SeatId">("seat-open-cap"), shiftId: asId<"ShiftId">("shift-open"), role: CAPTAIN, kind: "required", state: "Open" });
  await repo.saveSeat({ id: asId<"SeatId">("seat-open-mate"), shiftId: asId<"ShiftId">("shift-open"), role: MATE, kind: "required", state: "Open" });

  // crew-dooley: a busy reliability history, so /crew shows the worst-case
  // standing line (every reason kind at once — #32). No shifts/asks of his own;
  // this seed is purely to eyeball the standing subline wrapping + neutral tone.
  const DOOLEY = asId<"CrewMemberId">("crew-dooley");
  await repo.saveCrewMember({ id: DOOLEY, name: "Dooley", email: "dooley@bb.test", phone: "+15555550103", ratings: [CAPTAIN], status: "active", reliabilityScore: null });

  // The reliability log is append-only (no upsert), so only seed it once — re-runs
  // would otherwise duplicate. Past timestamps (all before any plausible `now`) so
  // nothing is dropped by the future-event guard.
  if ((await repo.reliabilityEventsFor(DOOLEY)).length === 0) {
    const S = (n: string) => asId<"ShiftId">(`dooley-${n}`);
    const SEAT = (n: string) => asId<"SeatId">(`dooley-seat-${n}`);
    const day = (d: number) => new Date(`2026-05-${String(d).padStart(2, "0")}T12:00:00.000Z`);
    const HOURS = 60 * 60 * 1000;
    for (let i = 1; i <= 6; i++) await logShiftCompleted(repo, DOOLEY, S(`done-${i}`), day(i)); // showed 6/9
    await logAskAccepted(repo, DOOLEY, SEAT("ask1"), S("ask1"), day(7), 5 * 60 * 1000); // answered fast
    await logEscalationAccepted(repo, DOOLEY, SEAT("esc"), S("esc"), day(8)); // stepped up…
    await logAtRiskRescue(repo, DOOLEY, SEAT("rescue"), S("rescue"), day(9)); // …two times
    await logShiftBailed(repo, DOOLEY, S("latebail"), day(10), 30 * HOURS); // one late bail (>= 24h)
    await logShiftBailed(repo, DOOLEY, S("earlybail"), day(11), 1 * HOURS); // one early bail (< 24h)
    await logNoShow(repo, DOOLEY, S("noshow"), day(12)); // one no-show
    await logAskIgnored(repo, DOOLEY, SEAT("ig1"), S("ig1"), day(13)); // missed two asks
    await logAskIgnored(repo, DOOLEY, SEAT("ig2"), S("ig2"), day(14));
  }

  console.log("Seeded crew-quint: 1 confirmed shift (2 events, manifest, co-crew Hooper), 1 open ask, 1 self-claimable shift (/crew/open).");
  console.log("  + Quint's MMC expires ~30d out → the #57 credential nudge line shows on /crew.");
  console.log("  + Bail demo (#56): open the shift card → 'I can't make it…' — Quint is the only");
  console.log("    captain, so the seat rests Bailed and the shift lands on /admin/at-risk as a regression.");
  console.log("Seeded crew-dooley: full reliability log → worst-case standing line. View: /crew/dev-link?crew=crew-dooley");
} finally {
  await repo.close();
}
