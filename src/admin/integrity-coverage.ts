/**
 * Which safety net catches each table's references (#584).
 *
 * There are two nets and neither is complete: real foreign keys (Postgres enforces them
 * itself) and the referential-integrity diagnostic in `integrity.ts` (the service layer
 * asserting the spine on demand). A table in neither has nothing watching it — and until
 * this file existed, landing in that gap was the DEFAULT, because adding a table never
 * forced anyone to decide which net should catch it. Every table added after the diagnostic
 * was written arrived uncovered, silently.
 *
 * That is the same decay shape as DEC-127's hand-maintained index: a step at the end of a
 * task, skipped under deadline, invisible when skipped. The fix is the same one — make the
 * omission fail the build. `integrity-coverage.test.ts` reads the table list out of
 * `db/migrations/*.sql` and fails on any table not classified here. A new table is a red
 * build until someone writes down which net catches it, and `exempt` demands a reason, so
 * "nothing watches this" becomes a recorded decision instead of an oversight.
 *
 * What this does NOT do: verify that a `checked` entry's check is correct, or that it still
 * runs. It asserts a decision was made, not that the decision was implemented well — the
 * diagnostic's own tests cover that. Worth stating plainly, because a coverage map that gets
 * mistaken for proof of coverage is exactly the "green because it isn't looking" failure it
 * was written to prevent.
 */

export type Coverage =
  /** Postgres enforces it — see `20260722170000_fk_reservations_era.sql`. */
  | { kind: "fk"; refs: string[] }
  /** `checkIntegrity()` walks it. */
  | { kind: "checked"; refs: string[] }
  /** Deliberately unwatched. The reason is the point. */
  | { kind: "exempt"; reason: string };

export const TABLE_COVERAGE: Record<string, Coverage> = {
  // ── The spine: walked by checkIntegrity() ────────────────────────────────
  role_types: { kind: "checked", refs: [] },
  vessels: { kind: "checked", refs: ["manning[].roleTypeId", "homeLocationId"] },
  crew_members: { kind: "checked", refs: ["ratings[]"] },
  events: { kind: "checked", refs: ["vessel_id"] },
  // Both nets: the diagnostic walks event_id, Postgres enforces customer_id
  // (`reservations_customer_id_fkey`). Classified by the net that needs maintaining.
  reservations: { kind: "checked", refs: ["event_id", "customer_id (fk-enforced)"] },
  shifts: { kind: "checked", refs: ["vessel_id", "event_ids[]"] },
  seats: { kind: "checked", refs: ["shift_id", "role", "assigned_crew_member_id"] },
  asks: { kind: "checked", refs: ["seat_id", "crew_member_id"] },
  credentials: { kind: "checked", refs: ["crew_member_id"] },
  pto_windows: { kind: "checked", refs: ["crew_member_id"] },
  // crew_member_id is ALSO FK'd (on delete restrict) — checked here because the
  // diagnostic runs against the in-memory adapter too, which holds no constraints.
  // shift_id is deliberately un-FK'd (SPEC §2.9.2), so the walk is the only net on it.
  time_punches: { kind: "checked", refs: ["crew_member_id", "shift_id"] },
  // actor_id is FK'd (on delete restrict). `time_punch_id` is deliberately un-FK'd AND
  // deliberately allowed to dangle: a `deleted` row must OUTLIVE the punch it records —
  // it is the only remaining evidence those hours existed (#635). So unlike
  // time_punches.shift_id, this one must NOT be walked; a dangling ref here is the
  // expected steady state rather than a defect.
  // `actor_id` is FK'd (on delete restrict) — that is the whole enforceable surface.
  // `time_punch_id` is deliberately un-FK'd AND deliberately allowed to dangle: a
  // `deleted` row must OUTLIVE the punch it records, being the only remaining evidence
  // those hours existed (#635). So there is nothing here for the diagnostic to walk —
  // unlike time_punches.shift_id, a dangling ref is the expected steady state, not a
  // defect. Classified by the net that actually enforces something.
  time_punch_edits: { kind: "fk", refs: ["actor_id"] },
  magic_tokens: { kind: "checked", refs: ["subject_id (crew subjects only — polymorphic)"] },
  outbox_entries: { kind: "checked", refs: ["ask_id", "seat_id", "crew_member_id"] },
  locations: { kind: "checked", refs: [] },
  notice_outbox: { kind: "checked", refs: ["crew_member_id"] },
  ring_outbox: { kind: "checked", refs: ["crew_member_id"] },
  // Checked despite being append-only and unbounded, unlike `reliability_events` below. Two
  // differences carry it: volume (this logs operator ACTIONS — a crew add, drop or change —
  // where the scoring log records every ask and every response, several per ask), and
  // consequence (a dangling ref here renders a blank actor on an operator-facing surface, where
  // one in the scoring log is inert). If the action log ever grows to scoring-log volume, this
  // reasoning expires and it should be paginated or exempted.
  audit_events: { kind: "checked", refs: ["crew_member_id", "actor_id (admin actors only)"] },

  // ── Foreign-keyed: Postgres will not let these dangle ────────────────────
  payments: { kind: "fk", refs: ["reservation_id"] },
  gratuity: { kind: "fk", refs: ["reservation_id", "event_id"] },
  checkout_holds: { kind: "fk", refs: ["vessel_id", "offering_id"] },
  offerings: { kind: "fk", refs: ["location_id"] },
  blocks: { kind: "fk", refs: ["vessel_id", "location_id"] },
  customers: { kind: "exempt", reason: "parent table — no outgoing references. It is the target of reservations_customer_id_fkey, not the holder of one." },

  // ── Waiting on a Repository port method (#584 follow-up) ─────────────────
  // These carry real references and nothing watches them. They need a `listAll*` on the
  // port plus both adapters plus a contract test before the diagnostic can walk them —
  // which is the actual work, and why they are enumerated here rather than quietly absent.
  guest_contacts: { kind: "exempt", reason: "needs listAllGuestContacts — refs reservation_id, shift_id (#584)" },
  calendar_feeds: { kind: "exempt", reason: "needs listAllCalendarFeeds — refs crew_member_id (#584)" },
  sms_consent: { kind: "exempt", reason: "needs listAllSmsConsents — refs crew_member_id (#584)" },
  threads: { kind: "exempt", reason: "needs listAllThreads (#584)" },
  messages: { kind: "exempt", reason: "needs listAllMessages — refs thread_id, sender_id (#584)" },
  message_reads: { kind: "exempt", reason: "needs listAllMessageReads — refs thread_id, subject_id (#584)" },
  thread_participants: { kind: "exempt", reason: "needs listAllThreadParticipants — refs thread_id, crew_member_id (#584)" },
  doorbell_notifications: { kind: "exempt", reason: "needs listAllDoorbellNotifications — refs thread_id, subject_id (#584)" },
  import_run_items: { kind: "exempt", reason: "needs listAllImportRunItems — refs run_id (#584)" },

  // ── Exempt on the merits ─────────────────────────────────────────────────
  reliability_events: {
    kind: "exempt",
    reason:
      "append-only scoring log (DEC-008). High-volume, and a dangling crew ref in an immutable log is benign — scanning it on a healthcheck would violate 'cheap'. Seat/shift ids live in jsonb metadata, not reference columns, so a shift delete cannot orphan it.",
  },
  presence: { kind: "exempt", reason: "observed-only, self-healing: a row for a departed subject stops being written and ages out (DEC-046)" },
  // Bounded, not short-lived: the PK is (subject_kind, subject_id), so a code is upserted in
  // place per subject rather than accumulating — but nothing deletes the row either.
  login_codes: { kind: "exempt", reason: "polymorphic subject_id (crew | admin); one row per subject, upserted in place" },
  // NOT "no reference columns" — `admins.id` IS a crew id (0018_admins.sql: "the crew id of the
  // crew member who is admin"), so a departed admin leaves an unresolvable row. It reads as
  // convention rather than a ref column, which is exactly why nothing checks it.
  admins: { kind: "exempt", reason: "needs listAllAdmins — `id` is itself a crew_members.id (#584)" },
  app_settings: { kind: "exempt", reason: "singleton key/value; no references" },
  import_runs: { kind: "exempt", reason: "no reference columns" },
  add_ons: { kind: "exempt", reason: "tenant_id only, and there is no tenants table — tenant is config, not a row" },
};
