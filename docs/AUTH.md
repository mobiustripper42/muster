# Auth & identity

How a request becomes "this is who you are." Kept deliberately small. Read this
when sign-in confuses you (it will — see [Two things that trip people up](#two-things-that-trip-people-up)).

> **Stability:** the *shape* below — one signed cookie, two kinds, branch on `kind` —
> is steady. What moved in Phase 10 is the **admin identity**: DEC-092 made admins
> real, individually-revocable rows, and DEC-093 let a crew session switch up to
> admin without re-authenticating. The **admin sign-in door** is still a hand-minted
> link; that's the part still moving. The doc flags which is which.

## The whole model in one sentence

A request's identity is a **signed `muster_session` cookie** holding
`{ kind, id }` — `kind` is `"crew"` or `"admin"`, `id` is a string. There is **no
permissions matrix and no `role` column** (`0018` defers roles deliberately): every
page reads the cookie via `readSubject()` and branches on `kind`.

- `kind: "crew"` → `id` is a **roster crew member id** (`crew-quint`), validated.
- `kind: "admin"` → `id` is **that same crew id**, not a handle — every admin is also
  crew (DEC-092, `0018_admins.sql`). `readSubject` re-checks it against the `admins`
  table on every admin request and fails a row that is missing or `active=false`, so
  **deprovisioning one admin takes effect on their next request** — no
  `SESSION_SECRET` rotation, no logging everyone out. The short `handle` (`eric`) is
  a separate column: the key for `db:mint` / `db:admin`, never the session id.

That admin lookup is the **one stateful check** in the whole path — crew sessions do
no database read at all (`app/lib/auth.ts:88-96`).

Cookie: `httpOnly`, 14-day TTL, sliding-renewed in its last 3 days. `SESSION_SECRET`
is required in prod. Defined in `app/lib/auth.ts` (`readSubject`, `startSession`,
`endSession`, `buildSessionCookie`); the `AuthSubject` type comes from
`src/auth/magic-link.ts`, and `AuthSubjectKind` is in `src/domain/entities.ts`.

## The four doors (all just set that cookie)

Three mint a session from nothing. The fourth converts one you already have.

| Door | Kinds it can mint | How | Notes |
|------|-------------------|-----|-------|
| **Code-login** | **crew only** | `/crew` → enter email → 6-digit code | The prod front door. Flag-gated by `CREW_SELF_SERVE`. Validated against the roster, no-enumeration. (DEC-081) |
| **Magic link** | **crew or admin** | `npm run db:mint -- --admin=<handle>` / `--crew=<id>` prints a URL → opened, consumed at `/crew/auth` | Single-use, hashed token. **The only way to mint an admin session directly** — there is no admin sign-in form yet. (DEC-010/020) |
| **Dev-link** | crew or admin | `/crew/dev-link?admin=<handle>` or `?crew=<id>` | Dev-only shortcut — **404 in prod** (`isProdDeploy`). Same effect, no minting. The smoke-test backdoor. |
| **Switcher** | **crew → admin, admin → crew** | A form on `/crew` (`switchToAdmin`) and the admin surfaces (`switchToCrew`) — re-mints the other-kind session for the **same id**, no re-auth | **The escalation seam** (DEC-093). `switchToAdmin` is gated on the same `getAdmin(active)` check `readSubject` enforces, so a non-admin or revoked admin is bounced to `/crew` with no session change. `app/lib/switch-actions.ts` |

After any of the three minting doors, the landing redirect is `kind`-based: **admin →
`/admin/at-risk`**, **crew → `/crew`** (`app/(crew)/crew/auth/route.ts:134`). The
switcher lands on **`/admin`** instead. Sign-out (`endSession()`) just clears the
cookie.

### "How do I sign in as…" (local / `mill-dev`)

- **A crew member:** `mill-dev:3000/crew/dev-link?crew=crew-quint` → tap the button.
  (Or the real flow: `/crew`, enter the crew member's email, paste the code — the
  code is echoed at `/crew/dev-code` in dev.)
- **The operator:** `mill-dev:3000/crew/dev-link?admin=eric` → tap the button →
  lands on `/admin/at-risk`. (Or mint a link: `npm run db:mint -- --admin=eric`,
  open the printed URL.)

The code-login front door mints a **crew** session — it never hands you an admin
session directly. But if your crew id is an active admin, the **switcher** takes you
the rest of the way with no second authentication, so in practice **one crew code
reaches both apps**. If you signed in and saw no operator surfaces, either you aren't
in the `admins` table or your row is `active=false`.

> **Say the consequence out loud:** a guessed or stolen crew login code *for someone
> who is an admin* yields admin access. That is why the login-code attempt cap **is**
> the security model (DEC-081), and why its concurrency bypass was treated as a
> launch-gating fix (#297, now atomic — `src/auth/login-code.ts`).

## Two things that trip people up

1. **"crew" means two different things.**
   - a session **kind** (`kind: "crew"`), *and*
   - the **roster of people** (the `crew_members` table).

   The operator signs in as `kind: "admin"`, but *also* has a **roster identity**
   so the office can appear as a participant in messaging and the doorbell. So the
   operator wears two hats: an `admin` *session* and a `crew-*` *persona*.

2. **`OPERATOR_CREW_MEMBER_ID` is not about login.**
   It's the crew persona the **office acts as** when posting messages / ringing the
   doorbell (DEC-030 §7) — default `crew-eric`, override in env. Setting it does
   **not** change your session's `kind`. (It's the env var with `OPERATOR` in the
   name that *looks* like a role switch but isn't — the classic red herring.) Its
   value should be a crew id that actually exists in the roster. Defined in
   `app/lib/operator.ts`.

## Gating pattern (for devs)

Every protected page/action resolves the subject first and branches on `kind`:

```ts
const subject = await readSubject();
if (!subject || subject.kind !== "crew") redirect("/crew"); // or notFound(), or render signed-out
```

- **Pages** typically render a signed-out notice or `redirect`/`notFound`.
- **Server actions** `redirect` (it throws by design — keep it outside `try`).
- **Flag-gated surfaces** (e.g. `/crew/open`) check `selfServeEnabled()` on **both**
  the page and the action, so a flag-off prod can neither render nor POST.
- **Never trust an id from the request body.** The domain re-validates
  (e.g. `claimSeat` re-checks the full claimable predicate before its guarded write).

## Dev-only vs prod

`app/lib/flags.ts`:
- `selfServeEnabled()` → `CREW_SELF_SERVE === "1"`. Gates the crew code-login front
  door. OFF by default so `main` stays promotable.
- `isProdDeploy()` → true on a real prod deploy. The dev-only affordances
  (`/crew/dev-link`, the `/crew/dev-code` echo, login-code logging) all 404/inert
  when it's true.

## Today vs. future

- **Today (steady enough to rely on):** crew = code-login; an admin who is already
  signed in as crew switches up (DEC-093). Admins are **real identities** —
  `admins` rows keyed by crew id, CLI-managed via `db:admin add`, individually
  revocable by flipping `active` (DEC-092). Roles are deliberately deferred: all
  admins are equal, and `0018` leaves the `role` column as the clean seam.
- **Future (the part still moving):** a real operator **sign-in form**, so an admin
  who is *not* already a crew session has a front door that isn't a hand-minted
  link. When that lands, the *model* above doesn't change (still a `{kind, id}`
  cookie, still the `admins` gate); only the **Magic link** row is replaced. Update
  that row and this section, leave the rest.
