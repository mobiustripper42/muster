---
id: DEC-060
title: "Doorbell window defaults — batch/cancel 90 s, presence-staleness 5 min (the 6.3 spike)"
topic: "Messaging, presence & doorbell"
---

## DEC-060: Doorbell window defaults — batch/cancel 90 s, presence-staleness 5 min (the 6.3 spike)

**Decision:** Resolve the two tune-later doorbell windows deferred to task 6.3. **Batch / cancel window** (hold-before-ring, §7.2) = **90 s**; **presence-staleness window** (the param `isPresent` takes, §7.1) = **5 min**. Both land as **env-overridable consts** in `src/config/tenant.ts` (`DOORBELL_BATCH_WINDOW_MS` / `DOORBELL_PRESENCE_WINDOW_MS`) — not hardcoded constants — feeding the 6.4 decider; tenant-config data later (DEC-046 posture). Tune-on-real-use stays. Invariant: presence window **>** batch window.
**Why:** Two different jobs → two numbers, each defended by peer norms rather than guessed. **90 s batch/cancel:** Slack's explicit-leave mobile-push delay is ~1 min, SMS response cadence is ~90 s and read-time under 5 s, and the debounce-to-digest norm is 1–2 min; priority bypasses the hold (§7.4) so urgency isn't penalized, and the +30 s over the artifact's "~1 min" placeholder buys batching + cancel-on-read headroom — every cancel suppresses a real SMS send. **5 min presence:** pulled *under* the ~10 min passive-idle peers (Slack cursor-idle push trigger, Discord idle) because Muster presence is narrow (in-*that*-thread) and fails toward ringing, but kept well *above* the batch window because the coarse observed signal (DEC-046, no websocket yet) emits nothing while a crew member *reads* a thread without tapping — a shorter window would text someone staring at the message and break the keystone (§7.1).
**Tradeoff:** Both numbers are coarse-era defaults defended by peer norms, not measured against real BrewBoat crew behavior — accepted because they're env-tunable and explicitly tune-on-real-use, and priority-bypass caps the cost of a too-long batch hold. The 5-min presence default biases toward suppression (a crew member gone 3–4 min could get an in-app toast rather than an SMS); first-only-until-read plus the re-ring on the next message bound that miss.
**Revisit if:** real pilot use shows missed rings or annoyance; or DEC-047's websocket lands — presence becomes continuous and the staleness window collapses toward "connected + focused now" (a short socket-drop tolerance, not 5 min).
