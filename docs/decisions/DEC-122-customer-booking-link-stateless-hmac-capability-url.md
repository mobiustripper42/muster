---
id: DEC-122
title: "Customer booking link — stateless HMAC capability-URL + guest confirmation emit (renumbered from DEC-119 at the feature→main merge — main's DEC-119 is recurring weekday-off #411; 11.4, #370; extends DEC-020/098/108)"
topic: "Reservations & payments"
---

## DEC-122: Customer booking link — stateless HMAC capability-URL + guest confirmation emit (renumbered from DEC-119 at the feature→main merge — main's DEC-119 is recurring weekday-off #411; 11.4, #370; extends DEC-020/098/108)

**See also** — later decisions that changed part of this one:
- Corrected by DEC-151 — the `writeBooking` citation only — the stateless-HMAC capability URL and its non-interference with the race-critical CAS both stand
- Reversed by DEC-154 — the link MECHANISM only — the stateless HMAC and its `RESERVATION_LINK_SECRET`. The capability-URL MODEL stands unchanged: no login, re-openable (never single-use), bearer semantics, and one link surfacing the contact's other trips. The guest confirmation emit, its `booked`-only rule, the `GuestRecipient` shape and the structural best-effort posture are untouched.

**Status:** Decided 2026-07-13 (@architect, under DEC-105/108).

**Context.** 11.4 must give a Muster-native reservation a "manage my booking" link and email + SMS it to the
customer on booking. The existing capability link (`src/auth/magic-link.ts`) is **single-use** (consumed on
first verify) — wrong for a link the customer re-opens. And the send seam (`ChannelPort`) only addresses a
crew member (`Recipient.crewMemberId` required); a booking customer has email/phone, no crew id.

**Decision.** The manage link is a **stateless HMAC capability**:
`token = base64url(HMAC-SHA256(RESERVATION_LINK_SECRET, "reservation-link:v1:" + reservationId))`,
`URL = ${linkBase}/reservations/manage?r=<id>&t=<token>`. A **dedicated secret env
`RESERVATION_LINK_SECRET`** (per-purpose-secret convention, DEC-020; separate from `SESSION_SECRET` so link
rotation never logs anyone out). **No stored token row, no migration** — the verifier (the P12 manage page)
re-derives and constant-time-compares. NOT reusing magic-link's single-use CAS (a manage link must be
re-openable) and NOT touching `writeBooking`'s race-critical CAS.

- **Departure from DEC-098 (recorded):** DEC-098's persistent bearer is stored hash-at-rest with
  regenerate/turn-off; this one has **no stored row and no per-link revocation** — a leaked link dies only by
  rotating the secret (invalidates all booking links, not sessions). **Accepted** because the protected asset
  is view + request-cancel-out-of-band (money already moved through Stripe), not account/payment creds. A
  stored-token upgrade is a P12 drop-in if a threat model demands revocation — `booking-link.ts` is the only
  thing that changes.

**Guest confirmation.** Confirmation (email + SMS, both carrying the link inline) emits on the webhook's
**`booked` outcome ONLY** — never `already` (Stripe redeliveries resolve to `already`; sending there
re-notifies the customer every retry). The recipient is modeled as a **discriminated `GuestRecipient`**
(email/phone, no `crewMemberId`), **not** by widening `Recipient.crewMemberId` to optional — the crew
"always has a crewMemberId" invariant stays compiler-enforced (crew adapters narrow via `requireCrewId`).
Send is **structurally best-effort** — a confirmation failure (a channel send OR anything upstream: env, repo,
wiring) can never 500 the webhook (a committed booking → a 500 → Stripe retries the whole event); the core
webhook guards its `sendConfirmation` call AND the app wiring wraps its whole body, so the promise holds at
both layers. It fires for **whichever channels exist** (a booking may be email-only or phone-only); a failure
emits a **low-severity** observer (durable log / admin notice), distinct from the urgent `alertPaidButUnbooked`
money path. The
confirmation SMS is **transactional, not marketing** — it does not route through the crew `SmsConsent` gate.

**Release gate.** 11.4 ships the token **generator**; the **verifier** (manage page) is **P12**. Between the two,
an emitted link 404s — so the DEC-108 "Book Now" flag must **not** point real customers at Muster until P12
lands. (The Phase 11 exit gate only requires the link *emitted*, so this doesn't block building 11.4.)

**MESSAGING flag.** The #390 kill-flag isn't on `feature/reservations` yet; the wiring reads
`process.env.MESSAGING !== "false"` defensively now, to reconcile at merge. **Copy + the manage page are P12.**
