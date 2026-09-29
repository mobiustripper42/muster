-- 20260929183642_check_in_and_waivers.sql — the check-in & waivers module (Phase 18.1, issue #1115).
-- Timestamp-named per DEC-121. Applied in filename order by db/migrate.ts.
--
-- Spec: docs/design/check-in-and-waivers.md §6, scoped in by DEC-187. The draft schema there was
-- reviewed item by item with the operator (2026-09-29) before this was written; the choices below
-- are the outcome, and the reasons are here so the next reader does not re-derive them.
--
-- ## Three facts, kept apart
-- A guest SIGNED (guests.signed_at), crew CHECKED THEM IN (guests.checked_in_at), and the
-- departure was COUNTED (events.pax_counted). None is derived from another.
--
-- ## Business rules live in code, not here (DEC-131)
-- An adult signer gives an email, one signing covers at most one adult and ten kids, is_minor is
-- worked out from dob and then frozen, and nothing exceeds the boat's COI limit. All four are the
-- domain's. The tables carry structural facts only: references exist, required values are present.
--
-- ## Foreign keys, ON DELETE RESTRICT, as every new table here takes them (DEC-131)
-- Nothing in this app hard-deletes these rows, so RESTRICT never fires; it refuses a reference to
-- a row that does not exist. Signing happens only on booked departures, so the pending-row reaper
-- that made reservation_trail skip its keys never meets these.

-- ── waiver_templates ─────────────────────────────────────────────────────────
-- One version of the waiver text. INSERT-ONLY: new text is a new row, and no row is edited, so the
-- exact words a guest agreed to can always be produced. The current version is worked out, never
-- stored — the latest effective_from not in the future — which is why there is no retired_at:
-- retiring a version would be an edit to it. The body may be markdown; how it renders is 18.4's.
create table waiver_templates (
  id              text primary key,
  version         text not null,                                   -- the label, e.g. 'brewboat-2026-v1'
  body            text not null,                                   -- the exact text shown and agreed to
  effective_from  text not null,                                   -- ISO-8601 UTC — may be in the future
  posted_at       text not null,                                   -- ISO-8601 UTC — when it was posted
  posted_by       text not null references admins (id) on delete restrict
);
create index waiver_templates_effective_idx on waiver_templates (effective_from desc);

-- ── guests ───────────────────────────────────────────────────────────────────
-- One row per signing — or, in roster mode, per person named before they sign. NOT
-- guest_contacts (0020), which records that crew texted a booking's contact; the two are
-- unrelated and only the names are close.
--
-- EVERY SIGNING IS ITS OWN ROW, and nothing merges or replaces on phone or email: couples share
-- an email and families pass one phone down the line. The adapter inserts with
-- `on conflict (id) do nothing`, so a signature is never rewritten.
--
-- Grain is per-event, not per-shift: the Saturday 1/3/5 are three different parties. event_id is
-- the NOT NULL key because a walk-up has no reservation.
create table guests (
  id                  text primary key,
  event_id            text not null references events (id) on delete restrict,
  reservation_id      text references reservations (id) on delete restrict,  -- null = walk-up
  name                text not null,
  email               text,                                        -- lowercased — required on an adult (domain)
  phone               text,                                        -- E.164 — optional
  dob                 text,                                        -- ISO-8601 date — cleared by retention
  is_minor            boolean not null default false,              -- derived at signing, then frozen
  guardian_guest_id   text references guests (id) on delete restrict,
  guardian_relation   text,                                        -- parent | guardian | custodian

  -- the signature — null = unsigned (a guarded minor, or a roster-mode row)
  signed_at           text,
  waiver_template_id  text references waiver_templates (id) on delete restrict,
  signature_name      text,                                        -- as typed
  signed_ip           text,                                        -- evidence — cleared by retention
  signed_user_agent   text,                                        -- evidence — cleared by retention

  -- the tick at the gangway
  checked_in_at       text,
  checked_in_by       text references crew_members (id) on delete restrict,

  source              text not null,                               -- booker | self | crew
  created_at          text not null
);
create index guests_event_idx on guests (event_id);
create index guests_reservation_idx on guests (reservation_id);

-- ── the departure count, on events ───────────────────────────────────────────
-- The passenger count the mate sets: the CURRENT value only, no history, editable at any time
-- (operator, 2026-09-29: the regulation asks for the count, not a history of it). Never above
-- the boat's COI limit; the domain enforces that.
--
-- Written ONLY by setDepartureCount, which updates these three columns and nothing else.
-- saveEvent's upsert names its columns explicitly and leaves these alone, so the Xola pull or a
-- reprice never wipes a count — a contract test pins it.
alter table events add column pax_counted integer;
alter table events add column counted_at  text;                    -- ISO-8601 UTC of the latest set
alter table events add column counted_by  text references crew_members (id) on delete restrict;

-- Settings (age of majority, reminder days, roster mode) need no DDL: they are `checkin.*` keys in
-- app_settings (0006), read through a typed port with code defaults — the getPaymentConfig pattern.
