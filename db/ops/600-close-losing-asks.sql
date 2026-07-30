-- 600-close-losing-asks.sql — clear the #600 fallout from a live database.
--
-- NOT a migration. Migrations are schema and run automatically (DEC-121); this is a
-- one-off DATA repair, run by hand by the operator, deliberately outside db/migrations
-- so `db/migrate.ts` never picks it up. Per the DEC-S009 posture: ad-hoc production
-- data fixes are the operator's explicit call, never a silent automated action.
--
-- WHAT HAPPENED (DEC-145): when a claim won a seat, only the winner's ask was closed.
-- The losing recipients kept `responded_at IS NULL` forever — correctly un-swept while
-- the seat was filled, because the tick only sweeps `Asked` seats (DEC-067) — and then
-- detonated the moment the seat reopened: `expireAsks` found them, measured `sent_at`
-- against the 2h timeout, and stamped `ask_ignored` (weight -3) on all of them at once.
-- In production that charged five captains for silence on an ask from NINE DAYS earlier,
-- on a seat taken 51 seconds after they were asked.
--
-- ORDERING. Steps 1-2 are safe to run before OR after the code deploys, and running them
-- early is worth doing: it disarms the latent penalties immediately. Be aware that until
-- the code ships, a `withdrawn` ask still RENDERS as "timed out / silent" — every reader
-- falls through to that branch (`ask-trail.ts` outcomeOf). Nothing errors; the label is
-- just still wrong. After deploy it reads "seat filled".
--
-- Steps are independent and each SELECT is safe to re-run. Read the counts before
-- committing anything.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. INSPECT the armed asks (production showed 34).
--    Live asks sitting on seats that are ALREADY filled. Each is a latent unearned
--    penalty that fires the moment its seat reopens.
-- ─────────────────────────────────────────────────────────────────────────────
select a.id,
       a.crew_member_id,
       a.seat_id,
       s.state as seat_state,
       a.sent_at,
       now() - a.sent_at::timestamptz as armed_for
from asks a
join seats s on s.id = a.seat_id
where a.responded_at is null
  and s.state in ('Claimed', 'Confirmed')   -- COMMITTED_SEAT_STATES
order by a.sent_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DISARM them: close as `withdrawn`.
--    No reliability event is written — nothing happened worth scoring. `withdrawn`
--    (not the bare timeout stamp) is what keeps these out of the asked-set, so these
--    people stay re-askable for those seats.
--    Confirm the UPDATE count equals step 1's row count before COMMIT.
-- ─────────────────────────────────────────────────────────────────────────────
begin;

update asks a
set responded_at = now()::text,          -- ISO-8601 text, matching the app's writes
    response     = 'withdrawn'
from seats s
where s.id = a.seat_id
  and a.responded_at is null
  and s.state in ('Claimed', 'Confirmed');

-- rollback;  -- if the count looks wrong
commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. INSPECT the false `ask_ignored` events (production showed ~6, worst 9d 0h 15m).
--    Identified by their ask having sat open FAR longer than
--    ASK_SILENT_TIMEOUT_MINUTES (120). The 3h threshold is the 2h timeout plus slack
--    for the 15-minute tick cadence, so a legitimately-timed-out ask cannot be caught
--    by rounding. `a.response is null` excludes anything step 2 just marked
--    `withdrawn`, so this is order-independent.
-- ─────────────────────────────────────────────────────────────────────────────
select e.id as event_id,
       e.crew_member_id,
       e.timestamp as event_at,
       a.seat_id,
       a.sent_at,
       a.responded_at,
       a.responded_at::timestamptz - a.sent_at::timestamptz as open_for
from reliability_events e
-- NB: correlated on (crew, seat) only — `reliability_events` carries no ask id
-- (metadata has seatId/shiftId, not askId). If one crew member has SEVERAL asks for
-- the same seat (a withdrawn one plus a later genuine re-ask that also timed out),
-- this can match more than one pair. That is why every step here is run and counted
-- by hand: read step 3's list and confirm it is what you expect before step 4 deletes
-- anything. A per-ask correlation would need an `askId` in the event metadata, which
-- is a code change, not something to bodge in a repair script.
join asks a
  on a.crew_member_id = e.crew_member_id
 and a.seat_id        = e.metadata->>'seatId'
where e.type = 'ask_ignored'
  and a.response is null
  and a.responded_at is not null
  and a.responded_at::timestamptz - a.sent_at::timestamptz > interval '3 hours'
order by open_for desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. OPERATOR'S CALL: delete them. This BREAKS append-only (DEC-008) on purpose.
--
--    For: an append-only log earns its keep by being TRUE, and these rows record
--    something that did not happen. Each is -3 in a count-based 40-event window, so at
--    this fleet's volume the distortion persists for weeks and is invisible to anyone
--    reading a score.
--    Against: the log's integrity guarantee is the thing being spent.
--    Alternative: leave them and let them age out — costs weeks of mis-ordered asks
--    nobody can attribute.
--
--    READ THE STEP 3 LIST BEFORE RUNNING THIS. The match is by CRITERIA (an ask that
--    sat open past timeout + slack), not by incident, so it will surface any such row
--    in the database — not only the ones from the Brew 4 incident. That is the correct
--    criterion, but it means the row count is not known in advance. Keep the event_id
--    list from step 3 and check it against what you expect.
-- ─────────────────────────────────────────────────────────────────────────────
begin;

delete from reliability_events e
using asks a
where a.crew_member_id = e.crew_member_id
  and a.seat_id        = e.metadata->>'seatId'
  and e.type = 'ask_ignored'
  and a.response is null
  and a.responded_at is not null
  and a.responded_at::timestamptz - a.sent_at::timestamptz > interval '3 hours';

-- rollback;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. RELABEL the mis-swept asks (run alongside step 4).
--
--     Step 2 only catches asks that are still armed (`responded_at is null`). The
--     ones the sweep ALREADY hit carry the timeout marker — `responded_at` set,
--     `response` null — so deleting their bogus event in step 4 fixes the SCORE but
--     leaves the ask still reading "timed out / silent" in the ask trail and the
--     At-Risk trail. They were withdrawn in fact; the sweep just mislabelled them.
--
--     Same criteria as step 4, so run the two together or neither. If you skipped
--     step 4 on append-only grounds, skip this too — a `withdrawn` ask with a
--     surviving `ask_ignored` event would be a worse contradiction than either alone.
-- ─────────────────────────────────────────────────────────────────────────────
begin;

update asks a
set response = 'withdrawn'
from seats s
where s.id = a.seat_id
  and a.response is null
  and a.responded_at is not null
  and a.responded_at::timestamptz - a.sent_at::timestamptz > interval '3 hours'
  -- Only where the seat is FILLED: that is what makes it a withdrawal rather than a
  -- genuine (if very late) timeout on a seat nobody ever took.
  and s.state in ('Claimed', 'Confirmed');

-- rollback;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. VERIFY.
-- ─────────────────────────────────────────────────────────────────────────────
-- Expect 0 — nothing armed on a filled seat any more.
select count(*) as still_armed
from asks a
join seats s on s.id = a.seat_id
where a.responded_at is null
  and s.state in ('Claimed', 'Confirmed');

-- Expect 0 — no ask_ignored left whose ask sat open past the timeout + slack.
select count(*) as still_false
from reliability_events e
-- NB: correlated on (crew, seat) only — `reliability_events` carries no ask id
-- (metadata has seatId/shiftId, not askId). If one crew member has SEVERAL asks for
-- the same seat (a withdrawn one plus a later genuine re-ask that also timed out),
-- this can match more than one pair. That is why every step here is run and counted
-- by hand: read step 3's list and confirm it is what you expect before step 4 deletes
-- anything. A per-ask correlation would need an `askId` in the event metadata, which
-- is a code change, not something to bodge in a repair script.
join asks a
  on a.crew_member_id = e.crew_member_id
 and a.seat_id        = e.metadata->>'seatId'
where e.type = 'ask_ignored'
  and a.response is null
  and a.responded_at is not null
  and a.responded_at::timestamptz - a.sent_at::timestamptz > interval '3 hours';

-- Remaining ask_ignored per crew — these should now all be genuine silences.
select crew_member_id, count(*) as ask_ignored
from reliability_events
where type = 'ask_ignored'
group by 1
order by 2 desc;
