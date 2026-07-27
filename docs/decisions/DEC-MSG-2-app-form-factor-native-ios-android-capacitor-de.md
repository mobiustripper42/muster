---
id: DEC-MSG-2
title: "App form factor — native iOS + Android (Capacitor), de-prioritized"
topic: "Messaging, presence & doorbell"
---

## DEC-MSG-2: App form factor — native iOS + Android (Capacitor), de-prioritized

**Decision:** The eventual app form factor is **native on both platforms via a Capacitor wrap**, but
it is a **post-slice fast-follow**, not an M4 blocker. M4 ships the **channel port + fake/pilot
adapters** (DEC-MSG-3); the native wrap + push is a separate, later unit of work triggered when push
reliability actually matters (crew habitually in-app, or SMS cost/latency becomes a real constraint).
**Why:** iOS PWA web push is too flaky for a seconds-matter ask; reliable in-app push on iPhone
needs native APNs → Capacitor. But push is an **accelerant**, not the participation path — the
channel port (DEC-MSG-1/3) is, so nothing about crew *answering* depends on the native app existing.
Resolves the build-plan §7 native-vs-PWA question. (Channel research, 2026-06-03.)
**Tradeoff:** Reliable in-app push waits until after the slice proves out.
**Scope guardrail (enforce):** "Two native apps" must **not** inflate M4 into shipping/maintaining
two app-store builds. Until the trigger fires, the port's non-push adapters carry it.
**Revisit if:** Push reliability becomes load-bearing (Phase: post-slice fast-follow). **Rejected:**
RCS — verified RCS Business Messaging sender vetting (weeks–months, real fees) and *still* needs an
SMS fallback; all overhead, no payoff for one operator. Revisit in 12–18 months only if volume
changes the math.

> **Ops checklist (gated to the Twilio adapter swap — later, NOT M4):** 10DLC brand + campaign
> registered and approved before any send · long code provisioned · inbound webhook wired into the
> domain `recordReply` with REQ-CLAIM-1 race-safe claim logic (SPEC §3.1) · asks kept plain-text and
> strictly non-promotional (TCPA) · email path available for magic-link fallback + receipts (SPEC
> §3.2) regardless. Lead time is real, but it **no longer blocks the slice.**
