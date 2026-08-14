# Muster — Running It Locally

How to stand up the app, see the UI, and check a change. The stable recipe lives here so PRs don't
re-explain it — a PR's "test plan" should link here for setup and then name only the surface-specific
things to eyeball.

## Prerequisites
- **Docker** (for local Postgres) and **Node 22**.
- No `.env` needed for local work — `DATABASE_URL`, `SESSION_SECRET`, and the base URL all have dev
  defaults. (Copy `env.example` → `.env.local` only if you want to override.)

## Quick start
```bash
npm install
npm run db:up        # docker compose up -d  → postgres:17 on :5432 (muster_dev + muster_test)
npm run db:migrate   # apply db/migrations/*.sql
npm run db:seed:crew # seed "crew-quint": 1 confirmed shift + 1 open ask (so the crew app has data)
npm run dev          # next dev --webpack on :3000
```
Teardown: `npm run db:down` (keeps the data volume; add nothing to wipe).

## Opening it in a browser
This runs on the **`mill-dev` VPS, reached over Tailscale**, so from your laptop the app is:

> **http://mill-dev:3000**  ← use this, not `localhost`

`localhost:3000` only resolves from a shell *on* the VPS (which is why scripted smoke tests use it).
A VSCode port-forward of 3000 works too. The app honors whatever host you arrive on (links and
redirects are host-relative), so all three — `mill-dev`, a port-forward, `localhost` on the box —
work without config.

## Seeing the crew app (it needs a magic link)
The crew surfaces require a session, so you can't visit `/crew` cold — you enter through a magic link.
In dev there's a link issuer:

1. Open **http://mill-dev:3000/crew/dev-link?crew=crew-quint** → a **"Tap to sign in →"** page.
2. Tap the button → the magic-link landing (`/crew/auth`) shows a second **"Tap to sign in →"**
   confirm page. That extra tap is the prefetch guard (DEC-030): a GET only *peeks* at the token
   (link-preview bots in iMessage/SMS GET every URL); the **POST** behind the button is what
   consumes it, sets the `muster_session` cookie, and redirects to **`/crew`**.
3. You should see Quint's **ask** (Yes/No), **My shifts**, the standing chip, and the amber
   **credential line** (#57): "Your MMC expires &lt;~30d out&gt; — renew it to keep getting asked for shifts."

`/crew/dev-link` is **dev-only** (404 in production). What to try:
- Tap **In** / **Out** on the ask → it resolves (In claims the seat → moves to My shifts; Out reopens).
- **Bail (#56):** open the My-shifts row → at the card's bottom, expand **"I can’t make it…"** →
  tap **Drop this seat** → you land back on `/crew` with the calm "You’re off the … shift"
  notice and the shift is gone from My shifts. The fallout depends on who else is seeded
  (DEC-019, both honest):
  - **Crew seed only** → no other valid captain exists → the seat rests **Bailed** and the Hops
    shift shows on **/admin/at-risk** as a red **Lacking crew · late bail** regression.
    ⚠️ "Crew seed only" means a DB that has *never* run `db:seed:atrisk` — its captains persist
    (upserts never delete; `db:migrate` is forward-only and won't drop them), so a plain re-run of
    `db:seed:crew` on a contaminated DB **won't** get you here. Wipe the volume first:
    `docker compose down -v && npm run db:up && npm run db:migrate && npm run db:seed:crew`,
    *then* bail.
  - **At-risk seed also loaded** → that seed adds eligible captains, so the bail **re-asks** instead
    → seat goes `Asked`, shift `Filling`. A live ask far from the trip is suppressed from the board
    by design — open the Hops cockpit (`/admin/shift/shift-soon`) and watch the pool read
    *awaiting reply*. (Quick check of which path you're on: if `/admin/at-risk` shows
    `vessel-ar-*` rows, the at-risk seed is loaded — you're on this branch.)

  Re-running `npm run db:seed:crew` resets Quint's seat to Confirmed (undoes the bail), but does
  **not** remove at-risk shifts — only `docker compose down -v` (drop the volume) does.
- Open `/crew` with no cookie (private window) → the signed-out state.
- Mangle the `?t=` value → the expired/used-link copy.

> **Note:** the crew seed's shifts anchor to *now* (~2 weeks out, #101), like the `atrisk`/`outbox`
> seeds — they never rot on a future clock. Re-run `npm run db:seed:crew` to re-anchor + reset state.

### Signing in the front way (the 6-digit code)
`dev-link` above skips the front door. To exercise the real one — `/crew` → enter email → 6-digit
code (DEC-081, needs `CREW_SELF_SERVE=1`) — note that **the code will never reach an inbox in dev**:
the seeded crew all have undeliverable addresses (`quint@bb.test`). If `RESEND_API_KEY` +
`EMAIL_FROM` are set in `.env.local`, a real send is attempted and dropped, and because it runs in
`after()` the failure never reaches the page — the UI just says "check your email" forever.

Read the code out of the dev echo instead (`app/lib/auth-delivery.ts`, gated off on any prod deploy):

```bash
curl 'http://localhost:3000/crew/dev-code?email=quint@bb.test'
```

It is also printed to the dev-server terminal: `[login-code] → Quint <quint@bb.test>: 123456`.

**If nothing shows up, don't hit submit again — that is what keeps it from showing up.** The echo
only fires on `outcome: "deliver"`, and `mintLoginCode` returns `skip` in two cases that look
identical from the browser (`src/auth/login-code.ts`):

- **a live code minted less than 60s ago** (`RESEND_COOLDOWN_MS`, :160) — you already have one, so
  no second code is minted and nothing is logged. Retrying re-arms this every time.
- **a roster miss** (:149) — wrong email, or a DB the seed never reached.

The code itself is stored hash-only, so a code you missed the log line for is gone; you have to wait
the cooldown out. **Wait 60s, submit once, watch the terminal.** Only if it is still silent after a
clean 60-second gap is it a roster miss — re-run `npm run db:seed:crew` against the same
`DATABASE_URL` the dev server is using. (A `204` from the echo while an e2e server is alive on
`:3100` has one other known cause — see the stale-build note in `auth-delivery.ts`.)

## Seeing the At-Risk board (admin)
Admin needs **no seed** — there's no admin entity (DEC-020): the session subject is a free-form
handle, so any `?admin=<handle>` works in dev.

```bash
npm run db:seed:atrisk   # 4 board + 2 cockpit scenarios, trips anchored to NOW (re-run to re-anchor)
```

1. Open **http://mill-dev:3000/crew/dev-link?admin=spink** → tap the returned link, then the
   confirm page's **"Tap to sign in →"** (the DEC-030 prefetch guard) → you land signed-in on
   **`/admin/at-risk`** with "4 shifts need a call · 1 late bail".
2. The four rows, top to bottom: **Firkin** (red *Lacking crew · late bail* pill — always pinned
   first), **Tidewater** (trail: *asked 2 · 1 declined · 1 silent*, silent in red), **Growler**
   (*⊘ Gus's credential lapses before the trip*), **Mash Tun** (*Lacking crew · none eligible*,
   "not yet worked — flagged by the oracle" + the "nobody left in the eligible pool" line, no Lean
   buttons).
2a. **Fills-by deadline + multi-trip (#59, DEC-031):** in each row's right column, under the
   countdown, a **`fills by <day, time>`** line. **Firkin** and **Tidewater** (trips inside 48h) show
   it red with **`· overdue`** — a willingness/eligibility-exhausted shift boards only *after* its
   fills-by passes, so overdue there is correct, not a bug. **Growler** and **Mash Tun** (trips ~4–5d
   out) show a future fills-by in grey, no "overdue". **Tidewater also shows TWO `departs …` lines**
   (11-ish AM and ~2 PM — it's a two-trip day); the other rows show one. (Exact clock times shift
   each re-seed since trips anchor to NOW; the *shape* — two lines on Tidewater, red-overdue on the
   <48h rows — is the check.)
3. Tap **↗ Nudge Marisol** (Firkin row) → green *"Last action: nudged Marisol — asked, not yet
   filled"* and the Firkin row is **gone** — its ask is now in flight, which is the engine working,
   not a bug. (`/crew/dev-link?crew=crew-ar-sub` shows Marisol's Yes/No card if you want the loop.)
4. Tap **Assignment ↗** (Tidewater row) → the assignment cockpit (#54), badge **Filling**;
   in the pool, Lance reads *declined* (muted, with a **↗ Nudge** button) and Gardner *👻 silent*
   (red, **↗ Nudge**) — visibly different.

## The assignment cockpit (#54/#55)
Same seed. The cockpit is each board row's click-through, plus two off-board scenarios by URL:

1. Open **http://mill-dev:3000/admin/shift/shift-ar-claimed** → header shows trips + a mono
   **departs in Xd Xh** countdown, plus a **`fills by <day, time>`** line under the staffing horizon
   (#59, DEC-031 — grey here since this trip is ~3d out; red `· overdue` inside 48h). Petra's seat
   card is amber **Claimed** with *accepted — awaiting your confirm*. Tap **Confirm into seat** →
   green *"Petra confirmed into the seat"*, card turns green **Confirmed** with ✆ Call / ✉ Text
   links, badge flips to **Crewed**.
2. On any cockpit, tap **Warming signals →** (bottom) → the warming panel (#55) lists **Kettle**
   (*departs in ~4d · 1 seat unfilled · 50% answered · 1 silent*) — trending, deliberately NOT on
   the board. Tap its link → Kettle's cockpit: Dale *declined*, Tessa *👻 silent*, both nudgeable.
3. On Kettle, expand **Manual override…** on the seat card → tap **Place Marisol** → green
   *"Marisol placed by override — confirmed"*; the warming panel empties ("Nothing warming.").
4. **Changed since reviewed (#58):** open **http://mill-dev:3000/admin/shift/shift-ar-changed** →
   under the header, an amber notice: *"Changed since you reviewed it — a booking landed or changed
   after you locked this shift…"* The shift is fully **Crewed** and off the board; the nudge fires
   because it was locked 2d ago and a booking landed 1h ago (an earlier booking, stamped before the
   lock, is correctly ignored). Re-locking would clear it (no lock action wired to the cockpit yet —
   derivation only, DEC-029).
5. Re-run `npm run db:seed:atrisk` to reset everything you just changed.

```bash
npm run db:tick          # run one engine tick by hand (DEC-023 — no scheduler in v1)
```
Prints the tick counters (asks fired, escalations, board landings, outbox relays queued). After a
tick, refresh the board: **Tidewater disappears too** — Tier-2 sent a direct nudge, so an ask is in
flight again. Re-running `db:seed:atrisk` resets all scenarios (it closes any in-flight engine asks).

## The operator outbox (#53, DEC-030)
The pilot channel: the engine fires an ask → it lands in the **outbox** as a card → the operator
texts it from their own phone via an `sms:` deep link. Best eyeballed **on a phone / at 375px** —
the Send button only opens a Messages composer on a device that has one.

```bash
npm run db:seed:outbox   # 3 cards: 2 relays + 1 addressed to the operator (trips anchored to NOW)
```

1. Open **http://mill-dev:3000/crew/dev-link?admin=spink** → tap **Tap to sign in** (one tap) → then
   open **http://mill-dev:3000/admin/outbox** → header shows **"3 asks need you"**, tightest trip
   first: **Bo / Tideline** (red ~20h countdown, *"2nd ask · Lance declined"*), **Spink / Keelhaul**
   (a **you** pill — inline red **Out** / green **In** buttons, NO Send link), **Mira / Maibock**
   (*"1st ask"*).
2. On the Bo card, tap **Send** (one tap): on a phone, Messages opens prefilled with the ask + a
   magic link; on a desktop browser the `sms:` link may do nothing — that's the OS, not a bug. Either
   way the button **flips in place** to a white **Resend** with **"sent · &lt;time&gt; · awaiting
   reply"**.
3. Tap **Resend** → the same composer re-opens (the recovery if the first text didn't actually go
   out; no state change). Refresh the page → the Bo card has moved to the muted **Sent · awaiting
   reply** section and the header now reads **"2 asks need you"**.
4. On the Keelhaul card (yours), tap **In** → green *"You're in — the seat is claimed."* and the
   card is gone (the ask is answered; nothing left to relay).
5. The full crew loop: paste the Bo card's magic link (it's the second line of the prefilled text)
   into a private window → the **"Tap to sign in →"** confirm page → tap → you land on `/crew` as
   Bo with the Tideline Yes/No ask. Answer it → back in the outbox, Bo's card is gone.
6. Re-run `npm run db:seed:outbox` to reset (old cards retire; fresh asks + links are minted).

## Other endpoints
- `GET /api/health` → `{ status, db.reachable, integrity: { ok, violationCount } }` (runs the no-FK
  integrity diagnostic; `degraded` if the DB is down or a dangling ref exists).
- `/admin` → links to the At-Risk board + the Outbox (roster/builder surfaces are later phases).

## Reproducing the checkout race by hand (`CHECKOUT_HOLD_MINUTES`)

A checkout hold lasts **15 minutes** (DEC-109). The residual race — the hold expires while a buyer
is still paying, a rival takes the freed slot and pays first, then the first payment lands — is
reachable by clicking, because that is how the app works. It just is not reachable *on demand*: at
15 minutes, reproducing it means two browsers and a fifteen-minute wait, so in practice nobody
checks it.

Set the hold short and it becomes a two-minute job:

```bash
CHECKOUT_HOLD_MINUTES=0.5 npm run dev     # 30-second holds
```

Stripe's webhooks go to Stripe, not to your laptop, so nothing is written locally until you forward
them. In a second terminal:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Leave it running. On first start it prints a `whsec_…` signing secret — put that in `.env.local` as
`STRIPE_WEBHOOK_SECRET`, alongside a test `STRIPE_SECRET_KEY`. Without the forward the payment
still succeeds *at Stripe* and no booking is ever written here, which looks exactly like the app
being broken.

Then:

1. **Browser A** — pick a departure, reach Stripe checkout, and *stop*. Don't pay.
2. Wait ~30 seconds for the hold to lapse.
3. **Browser B** (a different profile or a private window) — book the same departure and pay with
   `4242 4242 4242 4242`. It should succeed.
4. **Browser A** — now pay. Expect an **automatic refund** and a "sold out while you were paying"
   email/SMS; the operator gets no alert, because nothing needs a human.

Fractions are allowed (`0.5` = 30s). Garbage, `0` and negatives fall back to 15 rather than minting
a zero-length hold, which would make every buyer lose the race to themselves.

**It is ignored outright on a production deploy**, whatever it is set to — shortening a real buyer's
hold releases their slot while their card is still processing, manufacturing the exact race the
constant exists to bound. Previews still honour it, so a reviewer can exercise the race there.

For the same path without Stripe or a browser, `npm run db:paid-unbooked -- --lost` drives it
through the handler directly and prints what the safety net did.

## Checking a change
- **The gate:** `npm run verify` → core typecheck + app typecheck + tests + webpack build. Docker-free
  (the Postgres adapter contract suite skips cleanly when no DB is reachable). This is what `/kill-this`
  and CI run.
- **The adapter contract on real Postgres:** with the DB up, `npm run test:pg` (or just `npm run verify`
  while `db:up` is running) exercises the in-memory↔Postgres equivalence suite instead of skipping it.
  CI always runs this against a Postgres service container.
- **The e2e harness (#65):** Playwright over the crew + admin flows. Needs the DB up; it drives its
  own app server (`next dev` on **:3100**, pointed at `muster_test`) and resets+seeds the test DB
  per spec, so it never touches your dev data or the `:3000` server.
  ```bash
  npm run db:up               # if not already running
  npx playwright install chromium   # one-time, installs the browser
  npm run test:e2e            # headless run
  npm run test:e2e:ui         # interactive runner
  ```
  Covers: dev-link sign-in + crew render, ask Yes/No, bail→regression (crew-only), bail→re-ask
  suppression (both seeds), board nudge. All three seeds anchor their shifts to *now* (#101), so the
  suite never rots on a future clock.
- **Other UI changes:** for surfaces the harness doesn't cover, eyeball by hand via the flow above.
  PRs call out exactly which surface to look at.

## Production notes (not needed for local dev)
Two env vars are dev-defaulted locally but **must be set in production**:
- **`SESSION_SECRET`** — signs session cookies. Unset in prod = a repo-public signing key = session
  forgery; the app fails fast if it's missing in production.
- **`APP_BASE_URL`** — the real external origin, used to build any **delivered** magic link. Without it
  a delivered link is built from the client-controlled `Host` header (host-header injection → token
  theft). The dev Host-header fallback is convenience only.
- `DATABASE_URL` — the hosted Postgres connection string (the provider is deploy-time, vendor-agnostic).
