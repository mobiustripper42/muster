---
id: DEC-053
title: "Two sender numbers — scheduling vs doorbell — on the crew 10DLC campaign"
topic: "Messaging, presence & doorbell"
---

## DEC-053: Two sender numbers — scheduling vs doorbell — on the crew 10DLC campaign

**Decision:** Per artifact §5, scheduling SMS (the crew ask; call-time / dock changes) and
message-notification SMS (the doorbell ring) must land as **separate phone threads on the handset**.
Since phones thread by number, that requires **two sender numbers**, both registered under the crew
A2P / 10DLC campaign. Plain Programmable Messaging carries both (Twilio Conversations not required,
artifact §4). The real SMS doorbell number is gated to **10DLC** (registration in motion,
owner-driven) and stays **off the critical path** — the slice runs on the fake / relay adapter; the
SMS number is the final swap (DEC-MSG-1).
**Why:** Spink's explicit requirement that scheduling and chat pings not collapse into one
undifferentiated phone stream. **Tradeoff:** A second number to provision + carry on the campaign.
**Phase:** Phase 6 (6.9), gated to 10DLC.
