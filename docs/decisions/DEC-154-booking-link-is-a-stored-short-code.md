---
id: DEC-154
title: "The customer booking link is a stored short code (`/b/<code>`), not a stateless HMAC URL — 129 characters to 43, and revocable (#741)"
topic: "Reservations & payments"
amends:
  - id: DEC-122
    relation: reverses
    scope: "the link MECHANISM only — the stateless HMAC and its `RESERVATION_LINK_SECRET`. The capability-URL MODEL stands unchanged: no login, re-openable (never single-use), bearer semantics, and one link surfacing the contact's other trips. The guest confirmation emit, its `booked`-only rule, the `GuestRecipient` shape and the structural best-effort posture are untouched."
---

## DEC-154: The customer booking link is a stored short code (`/b/<code>`), not a stateless HMAC URL

**Status:** Decided 2026-08-14 (operator, #741).

**Context.** A production booking link was 129 characters:

```
https://muster.brewcle.com/reservations/manage?r=resv-<32 hex>&t=<43-char base64url>
```

Three contributors, none accidental — a 43-char token (base64url of a full SHA-256 HMAC), a 37-char
deterministic reservation id, and a 20-char path. That URL ships in the confirmation SMS, where length is
billed in segments.

DEC-122 chose the stateless HMAC deliberately and recorded the cost: **no per-link revocation, no expiry, no
reissue** — a leaked link dies only by rotating the secret, which invalidates every booking link at once. It
also named its own exit: *"a stored-token upgrade is a P12 drop-in if a threat model demands revocation."*
Two things then came due at once. The absence of revocation is exactly why "Copy manage link" had to be
gated off production (#686 / PR #737), and the absence of reissue is why the resend built there can only
re-send the same immortal URL forever.

**Why now, and not later.** `RESERVATION_LINK_SECRET` was never set in production (recorded 2026-08-11 while
diffing the hosting runbook against the live Vercel env). No production deploy has ever minted a manage link,
so **not one booking link exists in any customer's inbox**. That makes this a straight replacement: no dual
verification, no dead-linking anyone, no reissue campaign. **The window closes the day reservations go live**
(~Sept 1), after which every link already sent has to keep working forever.

**Decision.** A booking's manage link is `${base}/b/<code>` — **43 characters**, against 129.

- **The code is 14 Crockford base32 characters (~70 bits)**, minted from `crypto.randomBytes`, stored one row
  per code in `booking_codes` (`code` PK, `reservation_id` FK, `created_at`, `expires_at`, `revoked_at`).
- **Length is sized against guessing, not collision.** The threat is not guessing a *particular* booking's
  code — it is hitting **any** live one, so the search space divides by the number of live bookings. At
  10,000 live bookings and a sustained 1,000 guesses/sec: 8 chars ⇒ ~30 hours to a first hit; 12 ⇒ ~3,600
  years; **14 ⇒ ~3.7 million years**. Two characters over 12 buys 1,000× the margin. The 43-char HMAC it
  replaces was never *sized* — it was base64url of SHA-256 because that is what SHA-256 emits. This is the
  first time the number was chosen.
- **A credential, not an identifier.** `mintDisplayCode` (`src/customers/identity.ts`) is the nearest prior
  art and takes an injected `Math.random`. That is correct for a customer display code and wrong here; the
  alphabet is shared, the randomness source is not.
- **Reservation ids are unchanged.** The deterministic `resv-<sha256>` id is the Stripe-retry idempotency
  guard (`ON CONFLICT (id)`), not a naming choice. The code is a separate row pointing at it.

**A reissue kills its predecessor.** Minting a new code revokes every prior code for that booking. The
alternative — codes stack, all stay live — is friendlier and makes revocation meaningless in practice, which
is the only thing anyone would reach for this control to do. The cost is real and accepted: a customer who
kept the original text and never asked for anything lands on a "this link was replaced" page. That page
therefore has to tell them how to get a new one rather than merely refusing. A **resend** (#686) is
deliberately *not* a reissue — it reuses the live code, putting the same credential back where it already
was, in the customer's own inbox.

**Three outcomes, where the HMAC had two.** `ok`, `refused` (`revoked` | `expired`), and `unknown`. The
refused state names itself because whoever holds a revoked code already knew the booking existed — saying so
leaks nothing, and without it a customer reads "isn't valid" and concludes their booking is gone. `unknown`
covers a malformed code, an unknown code, a code whose reservation is missing, **and a read error** — a
database hiccup must not tell a customer their good link is dead.

**Expiry exists as a column and nothing sets it.** A manage page must stay open indefinitely for the
post-trip tip and the receipt, so there is no expiry policy today. The column and the guard exist so that a
policy is a value rather than a migration.

**The old scheme is deleted, not carried.** `booking-link.ts`, `reservationLinkToken`,
`verifyReservationLinkToken` and `RESERVATION_LINK_SECRET` are gone — from the code, the e2e harness and
`docs/DEPLOY.md`. Nothing in production ever minted a link against that secret, so there is nothing to keep
verifying. A compatibility shim would be a permanent second credential path guarding zero real links.

**Not decided here.** The production gate on the operator's "Copy manage link" (#686) stays as it is. A
revocable token on a clipboard is still a live token in a Slack thread, and the remedy depends on someone
noticing the leak — revisiting that gate is a decision someone should make on purpose, not a side effect of
this one.

### Amendment, 2026-08-15 (operator) — the gate is now conditional

Decided on purpose, as the paragraph above asked for. **On production the manage link renders on the one
render that immediately follows a reissue, and nowhere else.** Off production it renders as before.

Three things moved the decision:

- **A reissue has already killed the customer's previous link** by the time the new one appears. The
  operator is looking at a credential they minted deliberately, one action ago — nothing is exposed that
  outlived the decision to expose it. That is a materially different object from "this booking's standing
  link, on screen whenever anyone opens the pane".
- **The code is sayable.** 14 Crockford base32 characters, an alphabet chosen so I/L/O/U can't be misheard.
  The 129-character HMAC could not be read down a phone, which is the actual reason nobody ever wanted to
  see it. The realistic support call — customer at the dock, link gone, operator on the phone — now has an
  answer that doesn't depend on email or SMS working.
- **It removes a dead end this decision created.** A reissue whose send failed left the operator holding a
  notice saying the customer has no working link, with no way to deliver one. The link is now on screen in
  exactly that state, and the copy points at it.

**The exposure this still closes** is a link sitting on screen for every booking anyone opens — a
screenshot, a shared screen, a tab left open. That is the real risk for this operator, and it is worth
being precise: the "pasted into a chat thread" framing above was inherited from the code comment the gate
was born with, not from anything about how BrewBoat works.

Mechanically: the reveal is driven by the reissue action's own redirect params, so it does not survive a
reload, and the **code itself never travels in the URL** — the pane re-reads it server-side. A credential in
a query string would land in browser history and any access log that records one.
