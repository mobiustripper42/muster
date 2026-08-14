-- 20260814170248_refund_leases — the refund mutex (#726).
-- Timestamp-named per DEC-121; applied in filename order by db/migrate.ts.
--
-- THE DEFECT. `refundReservation` compares the booking's refunded total against the token the
-- operator's screen was rendered with, then calls Stripe. That closes a double-submit but not
-- true concurrency: two refunds of DIFFERENT amounts (two tabs, two operators) both read
-- `refunded = 0`, both pass the compare, and produce different Stripe idempotency keys — so
-- Stripe executes both, while `markPaymentRefunded`'s `greatest()` records only the larger.
-- Money leaves twice and the ledger under-reports it.
--
-- WHY A LEASE AND NOT A LOCK. The Stripe call is a network round-trip, and a Postgres
-- transaction must not be held open across one. (`cancelEventIfUnclaimed` can use an advisory
-- lock precisely because everything it touches is in the database; this cannot.) So the mutex is
-- a ROW claimed before the call and released after.
--
-- THIS IS THE `checkout_holds` PATTERN, deliberately (20260718142705). Same problem shape, same
-- solution: a unique key as the mutex, plus LAZY expiry — `now()` is not immutable, so liveness
-- cannot live in an index predicate. The acquire path deletes the expired row for the identity
-- first, then inserts; the primary key makes two live acquires collide.
--
-- WHY EXPIRY IS NOT OPTIONAL. A process that dies mid-refund would otherwise leave a row that
-- blocks every future refund on that booking forever — a worse failure than the one being fixed,
-- because it is silent and permanent. The TTL lives in `refund-payment.ts` (60s: longer than a
-- Stripe round-trip, shorter than an operator's patience).
--
-- ONE ROW PER RESERVATION, so `reservation_id` IS the primary key — the operator refunds "a
-- booking", and the per-charge split beneath it is one indivisible operation.
-- THE TOKEN IS NOT DECORATION. Release deletes by `(reservation_id, token)`, never by
-- reservation alone. Without it: refund A's lease expires while its Stripe call is still in
-- flight, refund B legitimately acquires, and then A's `finally` deletes B's LIVE lease — so a
-- third refund acquires alongside B and the race this table exists to close is reopened, in the
-- exact scenario (a slow Stripe call) that the expiry exists to handle.
create table if not exists refund_leases (
  reservation_id text primary key references reservations (id) on delete cascade,
  token          text not null,  -- per-acquire; makes release own-lease-only
  acquired_at    text not null,  -- ISO-8601 UTC
  expires_at     text not null   -- ISO-8601 UTC; past ⇒ the row is dead and re-acquirable
);
