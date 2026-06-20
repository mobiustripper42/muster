# Muster — Pilot Weekend Runbook

One page for running a real crew weekend on the hosted pilot: **seed → import → tick → outbox →
triage**. This is the *operational sequence*; for the why behind each surface read
[`OPERATOR_MANUAL.md`](OPERATOR_MANUAL.md), for first-time deploy setup read
[`DEPLOY.md`](DEPLOY.md), and for the click-by-click dress rehearsal read
[`E2E-PILOT-WALKTHROUGH.md`](E2E-PILOT-WALKTHROUGH.md).

---

> ## ⚠️ This is a PILOT, not production (#70)
>
> The channel that texts crew is **pilot-grade by design** and must not silently become the
> production channel. Verbatim from the production-readiness gate (#70):
>
> > Before flipping anything to a real production deploy: Twilio adapter in (DEC-MSG-1), a real
> > operator auth path, a conscious call on the single-operator constant, **and the timezone
> > (DEC-022) fix landed — this one gates even a private real-crew test on real data, not just a
> > public launch.** Until then, the pilot channel is **pilot-only** — say so loudly in any deploy
> > runbook.
>
> **Status of the four gate tells at pilot time:**
> - ✅ **Operator auth path** — resolved (5.2 / DEC-034: a prod-minted magic link; `db:mint`).
> - ✅ **Vessel-local time** — resolved (5.3 / DEC-032: times render in the tenant's zone, not UTC).
> - ⛔ **Still pilot-only — manual relay.** Crew asks are **not** auto-texted. They land in the
>   Outbox and *you* send them from your phone. (Twilio auto-send, DEC-MSG-1, is the production swap —
>   not built.)
> - ⛔ **Still pilot-only — single operator.** One hardcoded operator (`OPERATOR_CREW_MEMBER_ID`).
>   Fine for BrewBoat; revisit before multi-operator.
>
> A hosted pilot is enough to run a real weekend. It is **not** a public launch.

---

## Before the weekend (one-time)
**1. Make the deploy match `main`.** Vercel serves the **`production`** branch, not `main`:
```bash
/promote-production    # ff-merges main → production, pushes; Vercel auto-redeploys
# if main added a DB migration, run it against prod FIRST:
APP_BASE_URL=https://muster-sigma.vercel.app DATABASE_URL="<prod-neon-direct>" npm run db:migrate
```
**2. Confirm it's up:** open `https://muster-sigma.vercel.app/api/health` →
`{ status: "ok", db: { reachable: true }, integrity: { ok: true, violationCount: 0 } }`.
**3. Vercel on a Pro plan** — Hobby throttles the cron (which fires asks) to once a day. Vercel → Cron Jobs.

## 0. Sign in
`/crew/dev-link` is 404 in prod, so mint a **prod** link — set `APP_BASE_URL` + the prod `DATABASE_URL`
inline (or use the `mint-prod` alias from [`DEPLOY.md` §7](DEPLOY.md)):
```bash
APP_BASE_URL=https://muster-sigma.vercel.app DATABASE_URL="<prod-neon-direct>" \
  npm run db:mint -- --admin=spink
#  → CHECK the output's "(db: …)" shows the Neon host, NOT localhost:5432
#  → open the printed https://muster-sigma.vercel.app/crew/auth?t=… → "Tap to sign in" → /admin/at-risk
```
One sign-in lasts ~14 days (the cookie renews on use).

## 1. Seed — dress rehearsal first
**Do not point real crew at an untested weekend.** Run the demo-seed shakedown
([`E2E-PILOT-WALKTHROUGH.md`](E2E-PILOT-WALKTHROUGH.md)) end to end first — the seeds deterministically
hit every branch real data won't. Only proceed to real data once it passes clean.

## 2. Import — load the real week
In Xola: **Reports → Reservations**, date range **Leading Year**, export the `.xlsx`. Then at
**`/admin/import`**: upload → the board fills with upcoming trips + their crew seats.
- **Always Leading Year** (it filters by *booking* date — a short range silently drops trips booked months ago).
- **Re-import freely** — idempotent on the Xola Reservation ID; updates in place, never duplicates. Re-run whenever bookings change.
- A booking exported as `Cancelled` auto-cancels its trip's shift (crew aren't asked for a dead trip).

## 3. Tick — let the engine work
The **Vercel cron (`*/15`) is the only autonomous mover** — it fires the asks as each shift crosses
its staffing horizon. You don't trigger it; just confirm it's running at **Vercel → Cron Jobs**
(invocation history + logs). A manual tick (rare) is the CRON_SECRET'd route in
[`DEPLOY.md` §6c](DEPLOY.md). *Shift state is derived on read, so the board is always correct even if
the cron is wedged — a wedged cron only stops sends.*

## 4. Outbox — relay the asks (from your phone)
Open **`/admin/outbox`** on your phone. Each card is an ask the engine fired:
- Tap **Send** → Messages opens pre-filled with the ask + the crew member's magic link → send it.
  The button flips to **Resend / awaiting reply**.
- Cards with a **you** pill are addressed to you — answer inline (**In** / **Out**), nothing to send.
- Work the list down; the header counts how many still need you.

## 5. Triage — work the board
Open **`/admin/at-risk`**. **An empty board is success** — every trip is crewed or still being worked.
For each row that lands:
- Read the **System tried** trail; **↗ Nudge** someone who declined/went silent, or **Ask to fill** an
  available person. Decided already? **Manual override → Place** them.
- **Reschedule / Cancel are disabled** — handle those **by phone** with the customer.

---

## When something looks off
| You see | It means | Do |
|---------|----------|----|
| Empty board | The engine closed everything | Nothing — that's the win |
| A shift vanished from the board | A fresh ask is in flight for it | Open its cockpit → seat reads *awaiting reply* |
| No asks landing in the outbox | Cron not firing (Hobby plan? wedged?) | Vercel → Cron Jobs; confirm Pro plan |
| `/api/health` → `degraded` | DB unreachable or a dangling ref | Check Neon / the deploy; don't run the weekend on it |
| A confirmed shift went red (late bail) | Someone backed out with no time to refill | Lean on whoever's left, or phone the customer |

See [`OPERATOR_MANUAL.md`](OPERATOR_MANUAL.md) for the full playbook and the concepts behind each screen.
