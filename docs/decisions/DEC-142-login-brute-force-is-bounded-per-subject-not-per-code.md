---
id: DEC-142
title: "Login brute force is bounded per subject, not per code — and every verify failure is one generic response"
topic: "Crew self-serve, auth & admin identity"
---

## DEC-142: Login brute force is bounded per subject, not per code — and every verify failure is one generic response

**See also** — decisions this one changed part of:
- Refines DEC-081 — the cap only — `attempts` per code gains a rolling per-subject failure window, and the verify response collapses to one value. The email-as-channel and code-shape legs stand

**Decision.** Two changes to crew self-serve sign-in, both closing holes found by the #522 sweep 2
auth review with `CREW_SELF_SERVE=1` live in production.

**1. `verifyLoginCode` returns exactly one failure.** `VerifyFailure` was
`"invalid" | "expired" | "locked"`; it is now `"invalid"`, full stop. The app boundary redirects
identically for every failure, leaves the login cookie in place either way, and renders one message.

**2. A rolling per-subject failure window** (`failed_since` / `failed_in_window` on `login_codes`,
24h / 50 failures) sits on top of the per-code `attempts` cap. It survives the re-mint that resets
`attempts`, and it is enforced inside the same row-locked statement as the per-code cap.

**Amends DEC-081**, scope: *the cap only*. DEC-081's design stands — email as the crew channel, a
short number-pad-friendly code, security resting on the throttle rather than the code's entropy.
This supplies the throttle that reasoning assumed.

### Why the response collapsed

An unknown email could only ever produce `invalid`. A roster email at the attempt cap produced
`locked`, and after the TTL `expired`. So six wrong guesses — or one guess ten minutes late —
told an unauthenticated caller whether an address was on the roster. The rendered copy differed
too, and so did the cookie: `locked`/`expired` cleared the login cookie and `invalid` didn't, and
a `Set-Cookie` deletion is as observable as a status code.

DEC-081 names "the identical generic response, no leak" as load-bearing. It held for
`requestLoginCode` and never for `verifyLoginCode`, and two unit tests twelve lines apart pinned
the asymmetry as the contract, so the leak read as intended behavior.

The collapse lives in the **domain**, not the app boundary. A three-armed union invites the next
caller to branch on it for friendlier copy, which is precisely how it leaked. The distinction the
cap logic needs never crosses the return. If failure telemetry is ever wanted it goes to a log or
the outbox — a side channel the person guessing cannot observe.

**Accepted cost.** A crew member whose code genuinely expired is told it didn't match. The copy
names both possibilities and offers a fresh code, which is the same affordance the old branch gave
them.

### Why the window

`attempts` caps guesses per **code**, and a re-mint upserts the row with `attempts: 0`. The
sustained rate was therefore `MAX_ATTEMPTS` per resend-cooldown, indefinitely: ~7,200 guesses/day
against a 10⁶ space, in parallel across every roster email, with no per-IP limit anywhere in the
app. ~0.7%/day per target — better than even odds inside four months.

The amplification DEC-081 did not consider: **admins are crew** (DEC-092), so an admin's crew email
is on the same roster, and `switchToAdmin` escalates a crew session to the full cockpit in one
click. Guessing one 6-digit code reached the operator account, not one crew view.

At 50 failures/24h that is ~144× fewer guesses, putting a break well past the life of the
deployment.

**The bound must survive the re-mint or it is decorative.** `saveLoginCode` deliberately does not
touch the window columns; only `claimLoginAttempt` advances or ages them out. Both adapters carry
that rule and the contract suite asserts it, because one expresses it in SQL and one in JavaScript.

**Enforced in one statement**, for the same reason #297 made the per-code cap atomic: a separate
read-then-check is a race, and this cap *is* the security model.

### The tradeoff, stated

**Any per-subject cap is an account-lockout DoS.** Burn a crew member's window and they cannot sign
in until it rolls. That is why 50 is generous rather than tight — it is a number a real person
cannot reach by fumbling a code, so the honest reading of 50 failures in a day is that it is not
them.

Per-IP was rejected: it does not lock out a real crew member, but it is evaded with one proxy, and
it needs request-scoped state the domain core cannot see without breaking the port boundary
(DEC-DATA-1). Per-subject is the honest trade and its cost is named here rather than discovered.

**Not addressed here:** the request-stage timing side channel (two match-only DB round trips still
distinguish a roster email statistically), and crew session revocation — a departed crew member's
session is never invalidated, which DEC-092 scoped deliberately and which is its own decision to
revisit. Both are filed.

**Revisit if:** a real crew member is ever locked out by the window (the cap is too tight, or
something is retrying on their behalf), or general rate limiting lands — at which point the
per-subject window may be redundant with a per-IP bound applied earlier in the stack.

## Amendment, 2026-08-21 (eric) — the window gates guesses, not the code itself

**What this changes, and what still stands.** The per-subject window bound (50 failures / 24h,
surviving re-mints) is unchanged and still the security model. What changes is *where it sits
relative to the hash compare*. It used to gate the claim outright: `claimLoginAttempt` returned
null once the window was full, and `verifyLoginCode` returned the generic `invalid` before ever
comparing the presented code — so a **legitimate crew member holding the correct code got the same
`invalid` as the attacker**, locked out for the full 24h. The "Revisit if" clause above named
exactly this ("a real crew member is ever locked out by the window"); this is that revisit.

**The gate order was the whole bug.** A cap that refuses *guesses* is the accepted trade of this
decision. A cap that refuses the *correct code* is a different thing, and it fell out of the claim
sitting ahead of the compare rather than from any deliberate choice. It was also cheaply reachable:
~60 requests against a known roster email (guessable for the operator, who is crew per DEC-092)
burns the window and re-locks it daily — an account-lockout DoS on the highest-value account, with
no per-IP bound anywhere to slow it.

**Decision.** The presented code's hash is passed into `claimLoginAttempt` (issue #801). When it
matches the stored `code_hash`, the claim bypasses the *window* bound and — because a success is
not a failure — leaves the window counter untouched. Wrong guesses are unaffected: they never match,
so they are window-bounded exactly as before, and brute force is still capped at 50/day. The
per-code `attempts < MAX_ATTEMPTS` ceiling (DEC-081, #297) stays an independent `AND`: a code
already spent on five wrong guesses is dead even to a correct sixth. Enforced in the one row-locked
statement, both adapters, so it is race-safe and the double agrees.

**Why this is safe.** The window exists to bound *guessing*, and an attacker never presents the
correct code (that is the thing they are trying to find). Letting the correct code through grants no
new capability to anyone who does not already hold it, while removing the only way an unauthenticated
attacker could deny a specific crew member — or the operator — their own account.
