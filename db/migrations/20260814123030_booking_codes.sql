-- 20260814123030_booking_codes — the customer manage credential (#741, DEC-154).
-- Timestamp-named per DEC-121; applied in filename order by db/migrate.ts.
--
-- This table is what makes `/b/<code>` possible. DEC-122's manage link was a stateless HMAC over
-- the reservation id — no storage, and therefore no revocation, no expiry and no reissue. DEC-154
-- reverses that mechanism (not the capability-URL model itself): a row per code, so a leaked link
-- can be killed and a customer who lost theirs can be given a new one.
--
-- CONSTRAINT POSTURE (DEC-131): the DB holds STRUCTURAL invariants, never business rules. So the
-- code is a real primary key (uniqueness is the database's job — see `ensureBookingCode`, which
-- retries on the conflict this raises) and `reservation_id` carries a real FK. Whether a code is
-- *live* is a service-layer judgement (`bookingCodeRefusal`), not a constraint.
--
-- House style: text PK, ISO-8601 timestamps as `text` (verbatim round-trip, parity with the
-- in-memory double), `if not exists` for idempotent re-runs.
-- The FK is declared INLINE rather than in a follow-up `do $$ ... alter table` block (the shape
-- 20260722143000_customers used). Two reasons: this table is new, so there is no already-created
-- copy anywhere needing the constraint retro-fitted; and `src/admin/integrity-coverage.test.ts`
-- reads FK claims back out of the DDL, and it can see an inline `references` — a coverage claim
-- nothing can verify is exactly what that test exists to prevent.
--
-- ON DELETE CASCADE, unlike `reservations.customer_id`'s RESTRICT: a code is worthless without
-- its reservation, so an orphan row is pure risk (a live credential pointing at nothing). Nothing
-- deletes reservations today — cancellation is a status — so this is a posture, not a live path.
create table if not exists booking_codes (
  code           text primary key,   -- 14 Crockford base32 chars, ~70 bits (sized against
                                     -- guessing ANY live code, not against collision)
  reservation_id text not null references reservations (id) on delete cascade,
  created_at     text not null,      -- ISO-8601 UTC
  expires_at     text,               -- set ⇒ dead after this instant. Unset today: a manage page
                                     -- must stay open for the post-trip tip and the receipt
  revoked_at     text                -- set ⇒ killed by a reissue or an operator revoke
);

-- Reissue reads every prior code for a reservation to revoke them; the operator pane reads the
-- same list to know whether a live link exists.
create index if not exists booking_codes_reservation_id_idx on booking_codes (reservation_id);
