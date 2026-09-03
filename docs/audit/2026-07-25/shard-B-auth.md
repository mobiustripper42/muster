# Shard B — Auth / identity / login paths

**Subject:** how a request becomes an identity — session cookie, the sign-in doors, the admin gate,
revocation, and the security posture recorded against them.

**Audited tree:** `main` @ `4e901dd`.

> **Which-tree check (lesson 4).** Shard B's corpus is effectively tree-independent: `AUTH.md`,
> `SECURITY_AUDIT.md`, and `SPEC.md` are byte-identical between `main` and `feature/reservations`,
> and the auth **source** (`src/auth/**`, `app/lib/auth.ts`, `middleware`) has a **zero-line diff**
> between them. Only `RUNNING.md` differs (24 lines), and that divergence is deliberate and
> documented — see Noise. So unlike shard A, `main` is the right tree here.

**Primary docs:** `docs/AUTH.md`, `docs/SECURITY_AUDIT.md`, `docs/RUNNING.md`, `docs/SPEC.md`.
**Checked against:** `app/lib/auth.ts`, `app/lib/switch-actions.ts`, `app/lib/flags.ts`,
`app/lib/operator.ts`, `src/auth/*`, `db/migrations/0018_admins.sql`, `0019_*`, GitHub issue state.

## Findings

| # | doc:line | claim (verbatim, trimmed) | checked against | verdict | proposed bucket |
|---|----------|---------------------------|-----------------|---------|-----------------|
| B1 | `AUTH.md:38` | "The code-login front door **cannot** make you an admin — it's crew-only by design." | `app/lib/switch-actions.ts:36` `switchToAdmin`, rendered at `app/(crew)/crew/page.tsx:575`; `SECURITY_AUDIT.md:31` — "Since admins now sign in via crew code login (DEC-093), a guessed crew-admin code → admin access" | CODE-CONTRADICTS | doc-wrong |
| B2 | `AUTH.md:19` | "`kind: \"admin\"` → `id` is an **operator handle** (`eric`, `eric`) — a *label*, **not** validated against any roster (there are no operator accounts yet)." | `app/lib/auth.ts:93-96` — `readSubject` does `getAdmin(id)` and fails on missing/inactive; `db/migrations/0018_admins.sql` — "`id` IS that person's crew id", `handle` is a separate column | CODE-CONTRADICTS | doc-wrong |
| B3 | `AUTH.md:30` (magic-link row) | "**This is the real admin sign-in today.**" | DEC-093 switcher is the live admin path (B1); `SECURITY_AUDIT.md:31` | MISMATCH | doc-wrong |
| B4 | `AUTH.md:96` | "**Future (the part still moving):** a real operator **sign-in** — proper operator accounts/identities instead of a hand-made link." | Accounts landed: `0018_admins.sql` (DEC-092, "admin becomes a first-class auth identity"), CLI-managed via `db:admin add` | MISMATCH | doc-wrong |
| B5 | `AUTH.md:14` | "There is **no roles table and no permissions matrix**: every page reads the cookie via `readSubject()` and branches on `kind`." | Second clause no longer holds — `readSubject` performs a **stateful** `admins` lookup for admin subjects (`auth.ts:88-96`, "the ONE stateful check"). *First* clause survives narrowly: `0018` states "NO `role` column — roles are deferred" | MISMATCH | doc-wrong |
| B6 | `SECURITY_AUDIT.md:21-38` | "## Decisions required before launch" — three items presented as pending operator calls, incl. "**Your call:** fix now (I'll do it) or fold into #189" | #297 **closed and fixed in code** — `src/auth/login-code.ts:209` `claimLoginAttempt` is now the atomic increment-if-under-cap the audit prescribed. #298, #299, #300, #302, #189 also closed. Of the 7 filed, only **#301** is open | MISMATCH | doc-wrong |
| B7 | `AUTH.md:22` | "the `Subject` type is `src/domain/entities.ts`" | No `Subject` export there. `entities.ts:334` exports `AuthSubjectKind`; the `AuthSubject` type is imported from `@core/auth/magic-link.js` (`app/lib/auth.ts:8`) | CODE-CONTRADICTS | doc-wrong |

## Severity read

**B1 and B2 are the ones that matter, and both cut the same way: `AUTH.md` describes a weaker,
simpler auth model than the one that ships.**

B1 is the sharper of the two because it *understates a blast radius*. `AUTH.md` tells a reader that
compromising the crew code-login door gets you crew access only — "crew-only by design," stated as a
guarantee. `SECURITY_AUDIT.md` says the opposite in as many words, and `switch-actions.ts` is the
mechanism. A reader reasoning about "what does a guessed 6-digit code cost us" gets the wrong answer
from the doc whose whole job is that question. The switcher is not a footnote — it is a **fourth
door**, and `AUTH.md`'s "three doors" table has no row for it.

B2 is the inverse error — the doc understates what *exists*, claiming there are "no operator accounts
yet" when `0018_admins.sql` made each admin an individually-revocable row and `readSubject` enforces
it on every admin request. Anyone reading `AUTH.md` to answer "how do we revoke one admin" concludes
they must rotate `SESSION_SECRET` and log everyone out — which is precisely the problem DEC-092 was
written to solve.

B3–B5 are the same drift radiating outward: the magic-link row, the "Today vs future" section, and
the one-sentence model summary all still describe the pre-DEC-092/093 world. **`AUTH.md`'s own
stability note claims "the *model* below (one cookie, two kinds, the gating pattern) is steady" and
that only the admin door is moving. That got it backwards** — the door is still a minted link, but
the identity model underneath it changed.

B6 is a different failure: a security doc that reads as having three unresolved launch-gating
decisions when all three were decided and the HIGH one was fixed in code. It invites someone to
re-litigate settled calls, or worse, to assume the concurrency race is still live.

B7 is a stale pointer, low stakes, cheap to fix.

## Verified consistent (NOISE — recorded so it isn't re-derived)

| claim | source | verified against |
|---|---|---|
| Cookie `httpOnly`, 14-day TTL, sliding-renewed in last 3 days | `AUTH.md:21` | `app/lib/auth.ts:19-20` (`SESSION_TTL_MS`, `RENEW_WITHIN_MS`), `:46-48` (`httpOnly`, `sameSite: lax`, `secure` in prod) |
| `SESSION_SECRET` required in prod | `AUTH.md:21` | `app/lib/auth.ts:32` throws |
| `selfServeEnabled()` → `CREW_SELF_SERVE === "1"` | `AUTH.md:83` | `app/lib/flags.ts:11-12` |
| `isProdDeploy()` gates dev-only affordances | `AUTH.md:85` | `app/lib/flags.ts:35` |
| `OPERATOR_CREW_MEMBER_ID` defaults `crew-eric`, in `app/lib/operator.ts` | `AUTH.md:64` | `app/lib/operator.ts:27-28` |
| Crew sessions still have no per-person revoke | `AUTH.md` (silent) | No `sessionEpoch`/`revokeCrew` anywhere; `0018` scoped revoke to admins. #300 closed without a code change — doc and code agree |
| DEC-134/135 differ between `main` and `feature/reservations` | — | **Managed, not a collision.** `feature/reservations` renumbered main's 134/135 → 136/137, each annotated with provenance ("Authored on `main` as DEC-134; renumbered here"), same precedent as 126→131. DEC-137 documents `db:all` → `db:reset:dev` |
| `RUNNING.md` drops `db:all` on `feature/reservations` | — | Deliberate: `db:all` is gone from that branch's `package.json`, retired by its DEC-137 |

## Not checked

- **`SPEC.md` auth sections** — skimmed for contradictions against `AUTH.md`; none surfaced. SPEC
  treats auth at the "roles exist" level and defers mechanism, the same posture that made it thin
  for shard A.
- **The `switchToAdmin` seam itself** — `SECURITY_AUDIT.md` records it as verified gated on
  `getAdmin(active)` with `redirect()` halting before the mint. Re-auditing that is security review,
  not doc consistency; this shard only establishes that `AUTH.md` never mentions it.
- **#301** (the one open hardening bundle) — its contents are filed work, not a doc claim.
- **Live env** (Vercel Deployment Protection, whether `CREW_SELF_SERVE` is on in prod) —
  UNVERIFIABLE from the repo.

## Cost

Run in-context, like shard A — the corpus is four docs (~1,600 lines, of which SPEC is 1,221 and
mostly irrelevant) and a tight source surface. The single most expensive step was GitHub issue
state, which needed a `jq` pass over an 87k-character listing rather than the tool's own output.
