-- 20260816042221_checkout_hold_holder_token — one checkout session, one hold per departure (#575).
-- Timestamp-named per DEC-121; applied in filename order by db/migrate.ts.
--
-- THE DEFECT. `acquireDepartureHold` took the first free fitting boat and had no idea who was
-- asking. A declined card — the commonest checkout failure there is — meant: submit 1 holds the
-- small boat, submit 2 finds it held and takes the big one, submit 3 reports SOLD OUT. A two-boat
-- departure with zero paying customers, unbuyable by anyone, for fifteen minutes. The mechanism
-- whose only job is protecting the customer experience (a hold is what turns "you paid and we
-- refunded you" into "sold out, before you paid") was destroying it.
--
-- THE COLUMN IS A SESSION TOKEN, NOT A BUYER IDENTITY, and the difference is the whole design.
-- The first version of this migration stored a `buyer_key` — the canonicalized email or phone —
-- and reuse compared it. `/security-review` rejected that before it shipped: those fields are
-- typed into a public unauthenticated form, so the "authorization" for taking over a hold was
-- knowing a stranger's email address. It yielded a hold hijack (get handed the victim's boat and
-- a PaymentIntent on it) and a targeted deletion (their hold released via the fit-revalidation
-- branch). Neither needed a race or a payment.
--
-- `holder_token` is 32 CSPRNG bytes minted per checkout session and carried in an httpOnly
-- cookie. Reuse requires POSSESSION of it. Knowing who someone is buys nothing.
--
-- NULLABLE, and reuse requires non-null on both sides. A hold with no token — a client that
-- refused the cookie — gets pre-#575 behaviour: mint a fresh one, never reuse, never match
-- another tokenless hold. Two anonymous sessions sharing a hold is the one way this could sell a
-- boat twice. (SQL's `null != null` gives it for free; the in-memory double spells it out.)
--
-- No UNIQUE index. Whether a hold may be reused is a service-layer judgement — it re-checks that
-- the held boat still fits a changed guest count — and DEC-131 keeps business rules out of the
-- schema.
alter table checkout_holds add column if not exists holder_token text;

-- FORWARD-LOOKING, not load-bearing today, and worth being accurate about: the reuse path issues
-- no filtered query. `acquireDepartureHold` already reads every live hold via
-- `listCheckoutHolds()` — it needs them all anyway, to know which hulls are busy — and finds the
-- session's with a JS filter. Nothing currently plans against this index.
--
-- It exists because the shape of the question is now fixed, and because `checkout_holds` is only
-- small by virtue of a 15-minute expiry. If that stops being true, the fix is a filtered lookup
-- on the port, and this is the index it would want.
create index if not exists checkout_holds_holder_slot_idx
  on checkout_holds (holder_token, offering_id, date, time)
  where holder_token is not null;
