# Auth & identity

How a request becomes "this is who you are." Kept deliberately small. Read this
when sign-in confuses you (it will — see [Two things that trip people up](#two-things-that-trip-people-up)).

> **Stability:** the *model* below (one cookie, two kinds, the gating pattern) is
> steady. The **admin sign-in door** is the part still moving — today it's a
> hand-minted link; eventually it's a real operator sign-in. The doc flags which
> is which so it survives that change.

## The whole model in one sentence

A request's identity is a **signed `muster_session` cookie** holding
`{ kind, id }` — `kind` is `"crew"` or `"admin"`, `id` is a string. There is **no
roles table and no permissions matrix**: every page reads the cookie via
`readSubject()` and branches on `kind`.

- `kind: "crew"` → `id` is a **roster crew member id** (`crew-quint`), validated.
- `kind: "admin"` → `id` is an **operator handle** (`spink`, `eric`) — a *label*,
  **not** validated against any roster (there are no operator accounts yet).

Cookie: `httpOnly`, 14-day TTL, sliding-renewed in its last 3 days. `SESSION_SECRET`
is required in prod. Defined in `app/lib/auth.ts` (`readSubject`, `startSession`,
`endSession`, `buildSessionCookie`); the `Subject` type is `src/domain/entities.ts`.

## The three doors (all just set that cookie)

| Door | Kinds it can mint | How | Notes |
|------|-------------------|-----|-------|
| **Code-login** | **crew only** | `/crew` → enter email → 6-digit code | The prod front door. Flag-gated by `CREW_SELF_SERVE`. Validated against the roster, no-enumeration. (DEC-081) |
| **Magic link** | **crew or admin** | `npm run db:mint -- --admin=<handle>` / `--crew=<id>` prints a URL → opened, consumed at `/crew/auth` | Single-use, hashed token. **This is the real admin sign-in today.** (DEC-010/020) |
| **Dev-link** | crew or admin | `/crew/dev-link?admin=<handle>` or `?crew=<id>` | Dev-only shortcut — **404 in prod** (`isProdDeploy`). Same effect, no minting. The smoke-test backdoor. |

After any door, the landing redirect is `kind`-based: **admin → `/admin/at-risk`**,
**crew → `/crew`**. Sign-out (`endSession()`) just clears the cookie.

### "How do I sign in as…" (local / `mill-dev`)

- **A crew member:** `mill-dev:3000/crew/dev-link?crew=crew-quint` → tap the button.
  (Or the real flow: `/crew`, enter the crew member's email, paste the code — the
  code is echoed at `/crew/dev-code` in dev.)
- **The operator:** `mill-dev:3000/crew/dev-link?admin=eric` → tap the button →
  lands on `/admin/at-risk`. (Or mint a link: `npm run db:mint -- --admin=eric`,
  open the printed URL.)

The code-login front door **cannot** make you an admin — it's crew-only by design.
If you signed in there and expected operator surfaces, that's why.

## Two things that trip people up

1. **"crew" means two different things.**
   - a session **kind** (`kind: "crew"`), *and*
   - the **roster of people** (the `crew_members` table).

   The operator signs in as `kind: "admin"`, but *also* has a **roster identity**
   so the office can appear as a participant in messaging and the doorbell. So the
   operator wears two hats: an `admin` *session* and a `crew-*` *persona*.

2. **`OPERATOR_CREW_MEMBER_ID` is not about login.**
   It's the crew persona the **office acts as** when posting messages / ringing the
   doorbell (DEC-030 §7) — default `crew-spink`, override in env. Setting it does
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

- **Today (steady enough to rely on):** crew = code-login; operator = hand-minted
  magic link (or dev-link locally). Admin handles are unvalidated labels.
- **Future (the part still moving):** a real operator **sign-in** — proper operator
  accounts/identities instead of a hand-made link. When that lands, the *model*
  above doesn't change (still a `{kind, id}` cookie); only the **admin door** row in
  the table is replaced. Update that row and this section, leave the rest.
