---
id: DEC-095
title: "Operator At-Risk alert — the deferred delivery half of DEC-026, NOT a fourth outbound lane"
topic: "Outbound notifications & operator relay"
---

## DEC-095: Operator At-Risk alert — the deferred delivery half of DEC-026, NOT a fourth outbound lane

**See also** — decisions this one changed part of:
- Extends DEC-026 — the deferred delivery half

**Status:** Decided 2026-07-07 (@architect, Phase 10). Realizes DEC-026's deferred delivery ("the admin
ping ships the same moment crew-ask delivery does — one line at the send site") now that Twilio is live
(9.4/DEC-MSG-1).

**Context.** The tick already **detects + dedupes** board landings — one `board_landed` event per
(shift, reason) on the system log, re-pinging only on regression (`tick.ts`) — but the operator was never
actually notified; the delivery half was deferred to "the pilot adapter later" and, with SMS now live,
"later" is now. A pull-only board is a gap at go-time: the operator can't watch a board they aren't looking
at.

**Decision.** When a shift lands on the At-Risk board, alert **all active admins** by SMS. Delivered
**light** — NO own port/entity/table/adapter like asks (DEC-030), notices (DEC-084), or rings (DEC-073).
The rationale that justified those own-lanes (a hardened outbox with NOT-NULL correlation invariants + a
distinct durable lifecycle + an operator-relay worklist) **doesn't reach this feature**: the durable record
already exists (`board_landed`), the recipient IS the operator (no relay worklist — a relay-to-self outbox
is nonsensical), and the payload is a plain body + static `/admin/at-risk` link that rides `ChannelPort` as
a new `MessageKind` (`admin_alert`) through the Twilio adapter's **existing generic branch — zero adapter
change**. An own lane here would be a table with no distinct lifecycle: pure ceremony. Rejected.

- **Seam:** `tick` returns `boardLandings: {shiftId, reason}[]` (sibling to `firedAsks`), populated ONLY
  inside the dedup branch — the newly-recorded landings, never full board membership. Core stays clock-free
  + transport-free (DEC-023/030): it returns facts, the edge delivers via an injected channel.
- **Delivery** is core-but-transport-free (`src/adapters/forward-board-alerts.ts`, FakeChannel-tested):
  `listActiveAdminRecipients(repo)` (listAdmins → active → crew phone) + compose + best-effort per-recipient
  send. The edge (`app/lib/alert.ts`, sibling to `channel.ts`/`doorbell.ts`) picks the Twilio channel + the
  host-safe board link and calls it; the cron adds one line after `forwardToOutbox`.
- **Recipients = the active-admins set, NOT `OPERATOR_CREW_MEMBER_ID`.** The alert deliberately bypasses the
  operator singleton (its retirement is #293); `listActiveAdminRecipients` is authored as the reusable
  "the office = any active admin" helper #293 will consume.
- **No relay fallback, by design:** Twilio unset ⇒ no send (the `/admin/at-risk` board is the standing
  fallback). Unlike asks/notices/rings, an engine→operator alert has no one to relay to.
- **No civil-hours gating** (DEC-088 N/A) — a Tier-3 human-needed signal is inherently urgent; send any
  hour. **No migration.**

**Anti-blast (the one real trap).** Ride the existing per-(shift, reason) `board_landed` dedup: a
steady-state board fires **zero** alerts; only the tick that first records a landing sends, and a regression
(rescued → re-lands) re-pings. AC: a second tick on an unchanged board sends nothing.

**Scope held.** Trigger is At-Risk **only** (not Tier-2/earlier — that's the "anxiety dashboard" the board
design fights). An admin with no phone is skipped, not thrown on. Delivery is best-effort per recipient.

**Rejected:** an own outbox lane (a table with no distinct lifecycle); routing through
`OPERATOR_CREW_MEMBER_ID` (builds the exact thing #293 removes). **Relationship:** completes **DEC-026**
(delivery half); reuses **DEC-MSG-1** (Twilio swap) + **DEC-092** (admins entity + `active`); seeds the
**#293** helper. **Revisit if:** admins want per-person alert opt-in/subscribe (the eventual #293 model), or
alert volume warrants batching across ticks.
