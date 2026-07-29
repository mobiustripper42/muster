---
id: DEC-MSG-1
title: "SMS is the eventual production channel — via the port, not in the slice"
topic: "Messaging, presence & doorbell"
amends_spec:
  - section: "3.1"
    scope: "\"push/SMS\" is port-mediated — SMS is the eventual production adapter, not the slice's channel"
---

## DEC-MSG-1: SMS is the eventual production channel — via the port, not in the slice

**Decision:** SMS is the intended **primary production** channel for the crew ask (research-backed:
~98% read, minute-scale replies, no install/permission/gatekeeper, ~2–3¢ per round trip). But it is
delivered **through the channel port as one adapter** (DEC-MSG-3), and it is **explicitly excluded
from the first vertical slice.** The slice runs on the fake + pilot adapters; Twilio/SMS is the final
swap. Concretizes SPEC §3.1 "push/SMS" → "port-mediated; SMS the eventual production adapter."
**Why:** SMS via Twilio carries a real external dependency with lead time (10DLC). Chaining the slice
to it would gate "get a working app out the door" on carrier approval. The port lets the slice ship
now and adopt SMS later with **zero domain change** — if adding the Twilio adapter forces a domain
change, the port is wrong. (Channel research, 2026-06-03; **supersedes the REV 1 "M4 ships the SMS
loop" framing.**)
**Tradeoff:** Per-message cost and a 10DLC registration dependency with real lead time — now gated to
the Twilio adapter swap, **off the slice's critical path** (see ops checklist); plain-text, strictly
transactional asks to keep the TCPA posture.
**Revisit if:** Volume or cost/latency shifts the math enough to lean harder on push (Phase: Twilio
adapter swap, post-slice).
