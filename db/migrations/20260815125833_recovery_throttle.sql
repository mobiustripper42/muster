-- 20260815125833_recovery_throttle — bound the public "lost your link?" form (issue #460).
-- Timestamp-named per DEC-121; applied in filename order by db/migrate.ts.
--
-- WHY THIS EXISTS. `/b/find` is the only UNAUTHENTICATED endpoint in the product whose success
-- path spends money: every match sends an SMS, and a segment is billed. It also, by design,
-- answers identically whether or not anything matched — so nothing on screen would ever reveal
-- that someone is hammering it. Without a bound, one script points at it and the bill grows
-- silently. (Twilio is the live channel; `src/adapters/twilio-channel.ts`.)
--
-- THE SHAPE IS THE REFUND LEASE'S (20260814170248), for the same reason: a read-then-write
-- "have we sent recently?" races itself, and only the database can arbitrate. Claim a row under
-- a primary key, lazily expiring the dead one first — `now()` is not immutable, so liveness
-- cannot live in an index predicate.
--
-- KEYED ON THE CONTACT, NOT THE BOOKING, and deliberately claimed BEFORE matching: throttling
-- only on success would leave the no-match path unbounded, which is the path an attacker uses.
-- The cost is the one DEC-142 already accepted for login codes — someone can burn a real
-- customer's window and delay their recovery — so the window is short (minutes, not hours) and
-- the customer's other route, asking the operator to press Resend, is unaffected.
--
-- `contact_key` is the CANONICALIZED contact (lowercased email, or E.164 phone), so "216-555-0148"
-- and "+1 (216) 555 0148" share one bucket rather than being two free attempts.
create table if not exists recovery_throttle (
  contact_key    text primary key,
  claimed_at     text not null,  -- ISO-8601 UTC
  cooldown_until text not null   -- ISO-8601 UTC; at or before now ⇒ dead, and re-claimable
);
