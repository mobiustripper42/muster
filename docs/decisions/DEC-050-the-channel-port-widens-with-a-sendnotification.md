---
id: DEC-050
title: "The channel port widens with a `sendNotification` sibling to `sendAsk`"
topic: "Messaging, presence & doorbell"
---

## DEC-050: The channel port widens with a `sendNotification` sibling to `sendAsk`

**Decision:** Doorbell delivery rides the existing channel seam (DEC-MSG-1/3) but as a **new outbound
method `sendNotification`**, *not* by overloading `sendAsk`. The ask is a structured yes/no with
atomic-claim semantics (REQ-CLAIM-1) and an inbound `recordReply`; the doorbell ring is a **different
payload** — "new message, tap to open" (or a content-carrying short-notice text) with **no claim
logic and no inbound reply to record**. Both methods share the adapter family (fake / relay / Twilio)
and the outbox/relay machinery (DEC-030); the SMS doorbell adapter is the **final swap**
(DEC-MSG-1 posture).
**Why:** Overloading `sendAsk` with a no-claim payload would muddy the claim guarantees and break the
"zero domain change to swap Twilio" property for both. Distinct methods keep each clean.
**Tradeoff:** A second port method. **Rejected:** reusing `sendAsk` for rings. **Phase:** Phase 6
(6.6 / 6.9).
**Realized (6.6a, 2026-06-27):** as a **separate `NotificationPort` interface** (`send(NotificationMessage): Promise<SendResult>`), not a second method on `ChannelPort`. DEC-050 predates the seam becoming `send(OutboundMessage)`+`MessageKind`; a separate interface realizes "sibling to the ask path" most cleanly today and keeps the just-hardened ask `send`/`WebLinkChannel`/outbox (#158/#160) literally untouched, while preserving convergence — one future Twilio class implements **both** interfaces (DEC-MSG-1). Payload is **ring-only**: `{to, threadId, mode:"summary"|"content", body, messageIds}` — a toast (`in_app_toast`) is a 6.7 in-app read-model (DEC-068), never a port send, so there is no `channel` discriminator and no `mode:null`. 6.6a ships the port + `FakeNotificationChannel` recorder; the operator relay-of-rings adapter is **6.8** (#118, DEC-030 machinery).
