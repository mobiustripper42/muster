# Muster — End-to-End Pilot Walkthrough (Slice 1)

A structured, click-by-click acceptance test of the **whole first slice** — the crew engine as a
human actually drives it: operator + crew, board + cockpit + outbox + crew app. Where
[`docs/RUNNING.md`](RUNNING.md) explains *how to see each surface*, this doc is the *journey*: run it
top to bottom, mark each step, and log every surprise. It is the dress rehearsal before real crew
touch it.

> **This is a manual test.** Nothing here is automated (the Playwright harness is #65, not built).
> You — a human in a browser — are the test runner. The clicks are yours; the expectations are
> written down so "works" means something specific.

---

## How to run this (incl. CC-desktop on Windows)

- **The app runs on `mill-dev`** (the Linux VPS), reached over Tailscale. You test from any browser —
  including a Windows machine — at **http://mill-dev:3000**. Nothing compiles on your laptop; the
  build already runs on the box.
- **CC desktop is the notebook, not the builder.** A CC-desktop session can hold this doc open, walk
  you through each step, and **record findings** — but on Windows it can't compile or verify code, so
  it must **not edit source**. When it (or you) finds a bug, the output is a **GitHub issue**, not a
  commit. That's the clean hand-off to the CLI, where the fix gets built and tested.
- **Every failure becomes an issue.** Use the [Bug log](#bug-log) at the bottom as you go, then file
  each as a GitHub issue labeled `e2e` + `bug` (CC desktop can do this if `gh` is available, or paste
  the table back into a CLI session and I'll file them). The repo is the system of record — a bug
  that only lives in your memory didn't happen.
- **One pass = one Run record.** Fill the block below before you start so the results are dated and
  pinned to a commit.

### Run record

| Field | Value |
|-------|-------|
| Date | |
| Tester | |
| Commit (`git rev-parse --short HEAD` on the box) | |
| App URL | http://mill-dev:3000 |
| Browser / device | |
| Overall result | ☐ pass  ☐ pass-with-bugs  ☐ blocked |

**Marking convention per step:** `☐ pass  ☐ fail` + a one-line note. A step that can't run (blocked
by an earlier failure) → mark `blocked` and keep going where you can.

---

## Part 0 — Setup & reset protocol

The three dev seeds coexist (different vessels/crew), so you can load all of them. But several tests
are **destructive** (bail, confirm, override, relay-send) — the reset commands undo them. Run all
shell commands **on the box** (`ssh mill-dev`), not on Windows.

```bash
npm run db:up        # postgres in docker
npm run db:migrate   # forward-only schema
npm run db:seed:crew     # Quint: 1 confirmed shift + 1 open ask  (fixed dates 2026-07-04/05)
npm run db:seed:atrisk   # 7 board/cockpit scenarios (vessel-ar-*, anchored to NOW)
npm run db:seed:outbox   # 3 outbox cards (shift-obx-*, anchored to NOW)
npm run dev          # next dev --webpack on :3000  (leave running)
```

> **Starting a fresh pass?** The seeds **upsert and never wipe**, so running setup on top of a stale
> volume from a previous pass accumulates orphan rows — `/api/health` (0.2) then reads `degraded` with
> `violationCount > 0`. For a clean run, do the **full wipe** below first. (Re-running a single seed
> mid-run — a "reset" — is fine and does **not** need a wipe; only a *clean slate* does.) `db:up` now
> waits for Postgres to accept connections (`--wait`), so the chained wipe-and-seed won't race `db:migrate`.

**Full wipe** (drops the data volume — for a clean pass, or when a test says so):
```bash
docker compose down -v && npm run db:up && npm run db:migrate && npm run db:seed:crew
```

**Sign-in mechanic (used everywhere).** Crew surfaces need a magic-link session; there's a dev
issuer (404 in prod by design):
- **As the operator (Spink):** open `http://mill-dev:3000/crew/dev-link?admin=spink` → tap **"Tap to
  sign in →"** → you're in, redirected into the admin surfaces.
- **As a crew member:** open `http://mill-dev:3000/crew/dev-link?crew=<crewMemberId>` → tap the
  button → lands on `/crew` as them.
- Switching identity: just open a different `dev-link` URL (it re-cookies you). Use a **private/
  incognito window** when you want two identities at once (operator in one, crew in the other).

| # | Step | Expected | Result |
|---|------|----------|--------|
| 0.1 | Run the five setup commands above | All exit clean; each seed prints its scenario list; `npm run dev` says `Ready on :3000` | ☐ pass ☐ fail |
| 0.2 | Open `http://mill-dev:3000/api/health` | JSON `{ status: "ok", db: { reachable: true }, integrity: { ok: true, violationCount: 0 } }` | ☐ pass ☐ fail |
| 0.3 | Open `http://mill-dev:3000/crew/dev-link?admin=spink` → tap the green button | You land on an admin surface signed in (no "signed out" notice) | ☐ pass ☐ fail |

> **Clock gotcha:** the crew seed's shift is fixed at **2026-07-04/05**. If the box's clock is ever
> past those dates, Quint's *My shifts* goes empty (the ask still shows). Re-run `db:seed:crew` to
> reset. The `atrisk`/`outbox` seeds anchor to *now*, so they never rot.

> <a id="timezone-note-utc-everywhere"></a>**Timezone note (vessel-local — DEC-032).** Every clock
> time in the app now renders in the **vessel timezone** (`TENANT_TIMEZONE`, default Eastern /
> `America/New_York`; env-overridable via `TENANT_TZ`) — call times, departures, fills-by, horizon —
> the same boat-time crew and operator both read, regardless of viewer location. *(This replaced the
> old "UTC everywhere" simplification; task 5.3 / #77 closed the timezone half of the #70 gate.)* The
> seeds anchor trips to *now* and store wall-clock, so absolute times still shift each re-seed — read
> the **shape** (two trips ~3h apart on Tidewater, fills-by overdue inside 48h), not the literal
> AM/PM. With real Eastern Xola data the displayed time is now the true dock wall-clock.

---

## Part 1 — The crew member's world (SPEC §2.6)

Sign in as **Quint**: `http://mill-dev:3000/crew/dev-link?crew=crew-quint` → tap the button.

| # | Step | Expected | Result |
|---|------|----------|--------|
| 1.1 | Land on `/crew` | Header is Quint's name; a quiet grey **standing line** under it (never red/comparative) | ☐ pass ☐ fail |
| 1.2 | Read the **credential line** | Amber notice: *"Your MMC expires &lt;~date&gt; — renew it to keep getting asked for shifts."* — calm, not alarming | ☐ pass ☐ fail |
| 1.3 | Find the **ask** card (top) | *"&lt;date&gt; · &lt;vessel&gt; · &lt;role&gt;. **In or out?**"* with a red **Out** (left) and green **In** (right) | ☐ pass ☐ fail |
| 1.4 | Tap **In** | Page reloads; the ask is gone and the shift now appears under **My shifts** badged *"Awaiting confirmation"* — a non-clickable row (the seat is `Claimed`, not yet operator-confirmed, so it has no shift card to open yet) | ☐ pass ☐ fail |
| 1.5 | Re-seed (`npm run db:seed:crew` on the box), reload `/crew`, tap **Out** instead | Ask resolves and disappears; the seat reopens (does **not** move to My shifts) | ☐ pass ☐ fail |
| 1.6 | Re-seed again; tap a **My shifts** row | Opens the **shift card** at `/crew/shift/<id>` | ☐ pass ☐ fail |
| 1.7 | On the card, read the two big boxes | **Shift Start** (green) and **First departure** (plain) — distinct, labeled, mono times. This start-vs-departure split is the #1 dock confusion; it must be unmistakable | ☐ pass ☐ fail |
| 1.8 | Read the **Manifest** section | One collapsible per trip ("· different guests each trip"); expanding shows guest names ×party, phone tappable; a single-trip card is open by default | ☐ pass ☐ fail |
| 1.9 | Check **Crewing with you** + dock | Co-crew rows with **Call**/**Text** buttons (if any seeded); a **📍 dock** pin links to Google Maps | ☐ pass ☐ fail |

### Part 1b — Crew bail (destructive + order-sensitive, SPEC §2.6 / #56)

The bail's *outcome* depends on whether other eligible captains exist — both behaviors are correct
(DEC-019). For the **"seat rests Bailed → regression on the board"** outcome you need a DB with
**only** the crew seed (no atrisk captains). Do the **full wipe** first:

```bash
docker compose down -v && npm run db:up && npm run db:migrate && npm run db:seed:crew
```

| # | Step | Expected | Result |
|---|------|----------|--------|
| 1.10 | As Quint, open the My-shifts card → expand **"I can't make it…"** | A neutral explanation (no guilt-trip) + a red **Drop this shift** button behind the disclosure. The explanation is horizon-aware: a far-out shift reads *"…the sooner you tell us, the easier it is to refill…"*; one inside the staffing horizon reads firmer *"…call your operator right away…"* | ☐ pass ☐ fail |
| 1.11 | Tap **Drop this shift** | Back on `/crew` with a calm notice *"You're off the … shift — nothing else needed from you."*; the shift is gone from My shifts | ☐ pass ☐ fail |
| 1.12 | Sign in as Spink, open `/admin/at-risk` | The shift is there as a red **Lacking crew · late bail** regression (rested Bailed — no other captain to auto-refill) | ☐ pass ☐ fail |
| 1.13 | (Contrast) **Full-wipe, then seed crew AND atrisk** so eligible captains exist: `docker compose down -v && npm run db:up && npm run db:migrate && npm run db:seed:crew && npm run db:seed:atrisk`. Then bail again. *(Order matters — a wipe AFTER seeding atrisk would erase the captains you just added.)* | This time the bail **re-asks** — seat goes `Asked`, shift `Filling`, and a far-off live ask is suppressed from the board (open `/admin/shift/shift-soon`, pool reads *awaiting reply*) | ☐ pass ☐ fail |

### Part 1c — Auth edges

| # | Step | Expected | Result |
|---|------|----------|--------|
| 1.14 | Open `/crew` in a **private window** (no cookie) | The signed-out state: *"Tap the link your operator sent."* — never the app | ☐ pass ☐ fail |
| 1.15 | Take a `dev-link` URL, change a character in the `?t=` value, open it | The expired/used-link copy: *"That link didn't work… ask your operator for a fresh one."* | ☐ pass ☐ fail |

---

## Part 2 — The At-Risk board (SPEC §2.5, the operator's triage list)

Reset to a clean scenario set: `npm run db:seed:atrisk` (on the box). Sign in as Spink
(`/crew/dev-link?admin=spink`), open **`/admin/at-risk`**.

> **Read this first — the counterintuitive core:** an **empty board is success**, not an empty
> screen. Tiers 1–2 close shifts on their own; the board shows only what the automation *couldn't*.
> If you ever feel "nothing's happening," that's the system working. (See the explicit checklist in
> [Part 7](#part-7--the-counterintuitive-behaviours-checklist).)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 2.1 | Land on `/admin/at-risk` | Header *"Needs attention"* + *"N shifts need attention"* (4 board rows from this seed) + a *"1 late bail"* chip | ☐ pass ☐ fail |
| 2.2 | Read the four rows top-to-bottom | **Firkin** (red *Lacking crew · late bail*, pinned first) → **Tidewater** (*asked 2 · 1 declined · 1 silent*, silent in red) → **Growler** (*⊘ Gus's credential lapses…*) → **Mash Tun** (*none eligible*, System tried reads *"no one eligible to ask"*, no Lean buttons) | ☐ pass ☐ fail |
| 2.3 | Confirm the **ordering logic** | Sooner trips and the regression sort above never-filled shifts of similar time-to-trip; "captain vs mate" is *not* a label, it's pool-thinness | ☐ pass ☐ fail |
| 2.4 | **No fills-by on the board (DEC-038):** each row's right column | Shows **only** the `Xd Xh to trip` countdown — **no** `fills by …` line. Once a shift is on the board the automation has given up and you must act, so the deadline is moot here; it lives in the cockpit instead (verified at 3.2, where it reads **`deadline …`**) | ☐ pass ☐ fail |
| 2.5 | **Multi-trip (#59):** the **Tidewater** row | **Under the date** (left side, not split across the row — DEC-038) it shows **two** `departs …` lines (two times **~3h apart** — a two-trip day); every other row shows **one**. *Exact clock times vary per re-seed (trips anchor to NOW), render vessel-local — see the [timezone note](#timezone-note-utc-everywhere). Check the **shape** (two lines, ~3h apart), not the absolute time.* | ☐ pass ☐ fail |
| 2.6 | Read the **System tried** trail on Tidewater | *asked 2 · 1 declined · 1 silent* — the silent ghost called out distinctly; this is the proof-of-work line | ☐ pass ☐ fail |
| 2.7 | On the **Firkin** row, tap **↗ Nudge &lt;name&gt;** | Green *"Last action: nudged … — asked, not yet filled"* notice **and the Firkin row disappears** — its ask is now in flight (engine working, not a bug) + a "watch it ↗" link to its cockpit | ☐ pass ☐ fail |
| 2.8 | On **Mash Tun** (none eligible) | **No Lean buttons** — instead the honest line *"nobody left in the eligible pool — this is the reschedule / cancel call."* The system doesn't offer a nudge it knows is futile | ☐ pass ☐ fail |
| 2.9 | The disabled **Reschedule / Cancel** buttons on a row | Visibly disabled (greyed) under a short note: *"Handle reschedule/cancel by phone for now."* The *why* (customer payment cascades, parked) is on the buttons' hover title, not cluttering the row | ☐ pass ☐ fail |

---

## Part 3 — The assignment cockpit (SPEC §2.4, #54/#55)

Same `atrisk` seed. The cockpit is each board row's click-through, plus off-board scenarios by URL.

| # | Step | Expected | Result |
|---|------|----------|--------|
| 3.1 | From a board row tap **Assignment ↗**, or open `/admin/shift/shift-ar-claimed` | The cockpit: vessel · date · state **Badge**; trips + pax; a mono **departs in Xd Xh** countdown | ☐ pass ☐ fail |
| 3.2 | **Deadline header (#59, DEC-038):** under the staffing line | A **`deadline <day, time>`** line (grey for `shift-ar-claimed`, ~3d out; red `· overdue` inside 48h). This is the cockpit's live deadline — it does **not** appear on the board (2.4), only here where the shift is still being worked. The line above reads **`staffing: started <date>`** | ☐ pass ☐ fail |
| 3.3 | Read a **seat card** with a pool | Ranked eligible names with ask status: *declined* (muted), *👻 silent* (red) — visibly different — each with a **↗ Nudge** button | ☐ pass ☐ fail |
| 3.4 | On `shift-ar-claimed`, tap **Confirm into seat** (Petra is Claimed) | Green *"Petra confirmed into the seat"*; card turns green **Confirmed** with ✆ Call / ✉ Text; badge flips to **Crewed** | ☐ pass ☐ fail |
| 3.5 | Tap **Trending at-risk →** (bottom of any cockpit) | The panel lists **Kettle** (*~4d · 1 unfilled · 50% answered · 1 silent*) — a trending shift deliberately **not** on the board yet | ☐ pass ☐ fail |
| 3.6 | Open Kettle's cockpit → expand **Manual override…** on the seat → **Place &lt;name&gt;** | Green *"… placed by override — confirmed"*; the panel empties ("Nothing trending.") | ☐ pass ☐ fail |
| 3.7 | **Changed-since-reviewed (#58):** open `/admin/shift/shift-ar-changed` | Under the header, an amber notice *"A booking changed since this shift was last reviewed — take another look."*; the shift is fully Crewed and off the board (lockedAt seeded 2d ago; a booking landed 1h ago; an earlier booking before the lock is correctly ignored). NOTE: the lock/re-lock workflow ships with the Shift Builder (§2.3, later phase) — this notice only fires here from the seed | ☐ pass ☐ fail |
| 3.8 | Reset: `npm run db:seed:atrisk` | All cockpit scenarios restored (in-flight asks closed) | ☐ pass ☐ fail |

---

## Part 4 — The pilot channel: operator outbox (SPEC §2.x, #53, DEC-030)

**Best on a phone or at 375px width** — the Send button opens a Messages composer, which only exists
on a device that has one. Reset: `npm run db:seed:outbox` (on the box). Sign in as Spink, open
**`/admin/outbox`**.

| # | Step | Expected | Result |
|---|------|----------|--------|
| 4.1 | Land on `/admin/outbox` | Header **"3 asks need you"**, tightest trip first: **Bo / Tideline** (red ~20h, *"2nd ask · Lance declined"*) → **Spink / Keelhaul** (a **you** pill, inline **Out**/**In**, no Send link) → **Mira / Maibock** (*"1st ask"*) | ☐ pass ☐ fail |
| 4.2 | On the **Bo** card, tap **Send** | On a phone: Messages opens prefilled with the ask + a magic link. On desktop the `sms:` link may do nothing (OS, not a bug). Either way the button **flips in place** to a white **Resend** + *"sent · &lt;time&gt; · awaiting reply"* | ☐ pass ☐ fail |
| 4.3 | Tap **Resend** | The same composer re-opens (the recovery if the first text didn't send) — no state change | ☐ pass ☐ fail |
| 4.4 | Reload `/admin/outbox` | The Bo card has moved to the muted **Sent · awaiting reply** section; header now reads **"2 asks need you"** | ☐ pass ☐ fail |
| 4.5 | **Operator-as-crew:** on the **Keelhaul** card (yours), tap **In** | Green *"You're in — the seat is claimed."*; the card disappears (answered inline, nothing to relay) — note it never offered a Send link, only inline In/Out | ☐ pass ☐ fail |
| 4.6 | **The full crew loop:** copy the Bo card's magic link (2nd line of the prefilled text), paste into a **private window** | The *"Tap to sign in →"* confirm page → tap → land on `/crew` **as Bo** with the Tideline In/Out ask | ☐ pass ☐ fail |
| 4.7 | Answer Bo's ask (**In** or **Out**) → return to `/admin/outbox` | Bo's card is gone (the ask is resolved end-to-end through the relay) | ☐ pass ☐ fail |
| 4.8 | Reset: `npm run db:seed:outbox` | Old cards retire; fresh asks + links minted | ☐ pass ☐ fail |

---

## Part 5 — The engine tick (DEC-023, no scheduler in v1)

```bash
npm run db:seed:atrisk   # fresh scenarios
npm run db:tick          # run ONE engine tick by hand
```

| # | Step | Expected | Result |
|---|------|----------|--------|
| 5.1 | Run `npm run db:tick` | Prints counters: asks fired, escalations, board landings, outbox relays queued | ☐ pass ☐ fail |
| 5.2 | Refresh `/admin/at-risk` | **Tidewater disappears too** — Tier-2 sent a direct nudge, so an ask is now in flight. Fewer rows than before the tick = the engine made progress | ☐ pass ☐ fail |
| 5.3 | Reset: `npm run db:seed:atrisk` | All scenarios restored | ☐ pass ☐ fail |

---

## Part 6 — Cross-surface integrity & 375px

| # | Step | Expected | Result |
|---|------|----------|--------|
| 6.1 | `GET /api/health` after all the above | Still `status: "ok"`, `integrity.ok: true`, `violationCount: 0` — no orphaned rows left by the journey | ☐ pass ☐ fail |
| 6.2 | Re-run **every** surface at **375px** (phone or dev-tools device mode): `/crew`, a shift card, `/admin/at-risk`, a cockpit, `/admin/outbox` | Nothing clips, overflows, or overlaps; tap targets are reachable; the board's right-column (countdown + departs + fills-by) stays legible | ☐ pass ☐ fail |
| 6.3 | `/admin` | Links to the At-Risk board + the Outbox (roster/builder are later phases — their absence is expected) | ☐ pass ☐ fail |

---

## Part 7 — The counterintuitive behaviours checklist

These are the things that *look* like bugs but are the design. Confirm each reads as intended — if
any felt confusing in the moment, that's a **copy/UX bug worth logging**, not a code bug.

| # | Behaviour | Why it's correct | Felt clear? |
|---|-----------|------------------|-------------|
| 7.1 | An **empty board** ("Nothing needs you right now") | Success — the automation closed everything. Not a blank screen, not a reminder to go check | ☐ yes ☐ confusing |
| 7.2 | A row **vanishes** right after you Nudge/Lean | The ask is in flight — the shift left the triage list because it's being worked again | ☐ yes ☐ confusing |
| 7.3 | A **`deadline … · overdue`** in the cockpit (no longer on the board — DEC-038) | A willingness-exhausted shift only boards *after* its deadline passes — overdue is by construction. The deadline shows in the cockpit (where the shift is worked pre-board), not on the board (where the automation has already given up) | ☐ yes ☐ confusing |
| 7.4 | **Mash Tun has no Nudge buttons** | "Nobody eligible" — the system won't offer a futile nudge; that's the reschedule/cancel call | ☐ yes ☐ confusing |
| 7.5 | A **far-off bail re-asks** instead of hitting the board | A live ask with time to spare is suppressed — the board is for what *can't* be auto-handled | ☐ yes ☐ confusing |
| 7.6 | Reschedule/Cancel are **disabled** | Customer-side cascades land with payments (parked) — an honest disabled beats a half-working cancel | ☐ yes ☐ confusing |

---

## What this walkthrough does **not** cover (known gaps → the crew-test gate)

These are out of slice-1 scope and **must be resolved before real crew test from their own phones**:

- **No hosted deploy.** The app only runs on `mill-dev` over Tailscale. Real crew phones can't reach
  it without a public URL (Vercel is the intended target). → deploy work + a `production` branch.
- **No production auth path (#70).** `dev-link` is dev-only (404 in prod); the real magic-link
  consume in a deployed build is unproven, and the operator relay must text *real* numbers.
- **No automated e2e (#65).** This doc is the manual stand-in; the Playwright harness isn't built.
- **No real reservation import.** This walkthrough runs entirely on the **synthetic seeds** — which
  is *correct* for an engine shakedown, since the seeds deterministically exercise every branch
  (regression, exhaustion, credential lapse, multi-trip) that real Xola data wouldn't reliably
  produce. But it means the **Xola import is unexercised here.** Reality of that path today: it reads
  a **Xola `.xlsx`** (the "Reservations" sheet) via `importXlsx` — **core-only, no upload UI and no
  runner script**; you'd invoke it from a `tsx` script on the box. Putting **real BrewBoat data** in
  front of the crew next week needs (a) an import path a human can actually run, (b) confirmation the
  import → shift/seat derivation is wired end-to-end, and (c) the **timezone fix above** — real Xola
  times are Pacific-local, and the UTC render would mangle them. Tracked separately from this doc.

When this walkthrough passes clean on `mill-dev`, the slice is **shakedown-complete**. The crew test
is the *next* milestone, gated on the deploy + #70 above.

---

## Bug log

Copy a row per finding; file each as a GitHub issue (`e2e` + `bug` labels) after the run. CC desktop
can file them if `gh` is available; otherwise paste this table into a CLI session for triage.

| # | Surface / step | What happened | Expected | Severity (blocker/major/minor/copy) | Issue # |
|---|----------------|---------------|----------|-------------------------------------|---------|
| | | | | | |
| | | | | | |
| | | | | | |

---

## Sign-off

- [ ] Part 1 — Crew app (ask, my shifts, shift card, credential, bail)
- [ ] Part 2 — At-Risk board (membership, ordering, fills-by, multi-trip, lean)
- [ ] Part 3 — Cockpit (confirm, override, trending-at-risk, changed-since-reviewed, deadline header)
- [ ] Part 4 — Pilot channel / outbox (relay send, resend, operator-as-crew, full loop)
- [ ] Part 5 — Engine tick
- [ ] Part 6 — Integrity + 375px
- [ ] Part 7 — Counterintuitive behaviours read as intended
- [ ] All bugs filed as issues

**Tester sign-off:** ______________________  **Date:** ____________  **Result:** ☐ slice shakedown-complete  ☐ blockers found
