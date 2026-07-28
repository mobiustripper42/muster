---
id: DEC-030
title: "Pilot channel = operator-relayed web link; the outbox is adapter state, never domain state"
topic: "Outbound notifications & operator relay"
---

## DEC-030: Pilot channel = operator-relayed web link; the outbox is adapter state, never domain state

**Decision:** The DEC-MSG-3 pilot adapter is the **web-link relay**: `ChannelPort.send` does not
transmit — it enqueues an **`OutboxEntry`**, and the operator works a mobile **outbox page**
(`/admin/outbox`) where each pending ask is an **`sms:` deep-link Send button** (RFC 5724;
`buildSmsUrl`/`normalizePhone` ported from Bushel's send-queue) that opens the native Messages app
prefilled with the crew member's number, the ask body, and a magic link to the In/Out screen. The
crew member taps → lands authenticated → answers through the existing `recordResponse`. **No
Twilio, no inbound webhook.** The binding mechanics:

1. **Outbox state is adapter-side.** `OutboxEntry` `{id, askId, seatId, crewMemberId, body, link,
   status: pending|sent, createdAt, sentAt?}` is persisted via the Repository port (the `MagicToken`
   precedent), but the domain `Ask` is UNCHANGED and **nothing in `src/asks`, `src/builder`, or
   `src/oracle` may read outbox state** — only the adapter, the `outbox-view` read-model, and the
   outbox page. That guardrail is what keeps the Twilio swap a zero-domain-change drop-in (DEC-MSG-1).
2. **Mint at enqueue, render verbatim forever.** The magic link (**24h TTL** — the ask's answer
   window; the 15-min TTL stays dev-link-only) is minted inside the adapter's `send` and frozen
   onto the entry with the body — a page refresh must never re-mint and desync from what was
   already texted. Accepted tradeoff: the raw link (secret included) lives in `outbox_entries.link`
   — a DB leak yields live relay links, bounded by the 24h TTL + single-use consume; unavoidable if
   the operator is to re-render exactly what they texted.
3. **`SendResult.deliveredAt` = enqueue time.** The operator's physical text is `sentAt`,
   channel-side bookkeeping the domain never reads.
4. **Prefetch-safe consume.** Relay links travel through iMessage/Android SMS whose link-preview
   bots GET URLs before the human taps. `/crew/auth` GET now **peeks** (`peekMagicLink` — verify
   without consume, pure reads) and renders a "Tap to sign in" button; the **POST** consumes
   (single-use CAS), mints the session, 303-redirects. A bot can render the page forever; only the
   human's tap spends the token.
5. **Single-click Send — the one `'use client'` exception (DEC-026), progressively enhanced.**
   Send is an `<a href="sms:…">`: with NO JS the composer still opens via the native anchor (the
   graceful baseline). When hydrated the `onClick` takes over and **owns the order**:
   (1) `flushSync` the optimistic flip to a white **Resend** + "sent · &lt;time&gt;" (committed to
   the DOM synchronously, else the `window.location` hand-off occasionally wins the race and the
   flip never paints before the app switches to Messages),
   (2) `await recordSent` (no-redirect, no-revalidate server action) so the write FINISHES, then
   (3) open the composer via `window.location`. The order is load-bearing: opening the `sms:`
   composer is a navigation that **aborts an in-flight request** — a fire-and-forget `recordSent`
   got killed mid-flight ("Failed to fetch") and never persisted. The write is one quick local
   query and the flip already painted, so the wait is invisible; if it fails we open the composer
   anyway (the text matters most — Resend is the recovery). `components/outbox/relay-send.tsx` is
   the deliberate lone client island; everything else stays server-rendered. "Sent" means "you
   fired Send," not proof of delivery. No separate un-send (the operator asked for one tap).
   *Two dev-env gotchas, both fixed: (a) the app's first client component needs a `next dev`
   rebuild/restart to hydrate — Fast Refresh won't wire a brand-new client boundary into a running
   server; (b) Next 16 refuses HMR/hydration to non-localhost origins not in `allowedDevOrigins`
   (we reach dev via the Tailscale host `mill-dev` — see `next.config.ts`).*
6. **Channel wiring lives at the EDGE.** The fire paths surface their asks as return values
   (`TickResult.firedAsks`, `EscalateResult.asks`, `LeanResult.ask`, `BailOutcome.reAsks`) and the
   edge callers (app actions, the tick trigger) forward them via `forwardAsks` → the injected
   adapter, one line each. The channel is never threaded through the core ask loop; the forwarding
   glue is the durable part Twilio reuses verbatim. Forwarding is best-effort — the domain action
   already committed; a channel hiccup must not become a 500.
7. **Operator-as-crew.** One tenant-config value, **`OPERATOR_CREW_MEMBER_ID`**
   (`app/lib/operator.ts`, env-overridable constant — NOT a handle-keyed map; admin handles are
   free-form non-identities per DEC-020 and the session stays single-subject). An outbox ask whose
   `crewMemberId` matches renders **inline In/Out** instead of an `sms:` link — inline-or-relayed,
   never both (kills the double-answer race). The inline action is guarded by `recordResponseAs`,
   which refuses any ask not addressed to that identity (reliability-log integrity, DEC-008 —
   mirrors the crew app's ownership gate).

**ACCEPTED:** pilot `latencyMs` (ask `sentAt` → response) includes the **operator's relay delay** —
the clock starts when the ask fires, not when the text goes out. Scores are MVP-flat (DEC-008), so
nothing reads the skew yet, and it dies at the Twilio swap when `send` actually transmits.

**Phase:** Phase 4 / 4.1 (#53). (@architect passes — Fable — 2026-06-11.)
