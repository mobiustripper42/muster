---
id: DEC-MSG-3
title: "Channel adapters — one port, build in this order"
topic: "Messaging, presence & doorbell"
---

## DEC-MSG-3: Channel adapters — one port, build in this order

**Decision:** The crew ask reaches a person and collects a yes/no through **one outbound port
(`sendAsk`) and one inbound path (`recordReply`)**; concrete transports are **adapters injected at
the edge** — the same ports-&-adapters (hexagonal) shape as the oracle's policy/mechanism split
(DEC-001). The ask *logic* never talks to a transport directly. Three adapters, built in order:

| Adapter | Purpose | When |
|---|---|---|
| **Fake / log adapter** | Deterministic automated testing — `send` logs; replies come from a test helper / dev endpoint. Drives the seat + reliability state machine: timeout → `ask_ignored`, two simultaneous accepts → atomic claim (REQ-CLAIM-1), declines, bails. **Permanent test infra, not a throwaway.** | **M4 — required** |
| **Pilot adapter** | First real crew test weekend, no Twilio. **Option A — web link** (magic-link to the In/Out screen, §2.6.1, delivered manually by the operator) or **Option B — Telegram bot** (free, instant, inline Yes/No, requires crew to install Telegram). **Operator picks A or B later; build the port so either drops in — do not hardcode.** | **M4 — required (option deferred)** |
| **Twilio SMS adapter** | Production. Outbound SMS + inbound webhook → `recordReply`. Adding it must require **zero** change to the ask domain — if it doesn't, the port is wrong. | **Later — final swap, not M4** |

**Why:** "Add real SMS later" becomes *inject one more adapter*, not a refactor. The claim logic
(REQ-CLAIM-1) lives once in the domain behind the port, so it's identical and testable across every
transport without a live carrier. (Channel research Brief 2 + build-sequencing, 2026-06-03.)
**Tradeoff:** One indirection layer up front, before any real transport exists.
**Rejected:** **RCS** — verified-sender gatekeeping, fees, still needs an SMS fallback; revisit
12–18 months. **Twilio/SMS in the first slice** — deferred to the final adapter swap.
**Revisit if:** A transport need appears that the single `sendAsk`/`recordReply` shape can't express
(Phase: M4 for the port + fake + pilot adapters; Twilio swap later).
