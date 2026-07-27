---
id: DEC-068
title: "Presence enters the doorbell decider as a per-(subject,thread) three-state verdict; v1 fills it coarsely"
topic: "Messaging, presence & doorbell"
---

## DEC-068: Presence enters the doorbell decider as a per-(subject,thread) three-state verdict; v1 fills it coarsely

**Status:** Accepted (Phase 6 / 6.4) — @architect 2026-06-26 (Opus). Numbered past `main`'s DEC-061–067 (the feature/messaging branch is behind on DECs) so the eventual merge carries no duplicate number.
**Decision:** The pure doorbell decider (#114, DEC-048) takes presence as a per-`(subject,thread)` verdict with **three** states — `present_here | present_elsewhere | absent` — and maps them to **suppress-entirely** (§7.1) / **in-app toast** (§7.6) / **SMS-eligible** (§7.2–7.5). All three branches are written in 6.4. The **edge** produces the verdict: the v1 edge, fed only the global `lastActiveFor` signal + presence window (DEC-047/060), can never emit `present_here`, so it emits `present_elsewhere | absent` — the v1 observable is "present-anywhere → toast, absent → SMS" (a crew member reading the very thread gets a harmless redundant in-app toast, not silence). The `isPresent`/window classification lives **at the edge, not in the decider** — `here` vs `elsewhere` is socket knowledge, not derivable from a global timestamp.
**Why:** DEC-047 promises the realtime swap lands "with zero change to the doorbell decider" but doesn't specify the mechanism that keeps the promise. A per-subject *two*-state presence input would force adding a `present_here → suppress` branch — a decider + heavy-test + 6.5-harness rewrite — when per-thread presence arrives. Pre-shaping the input per-`(subject,thread)` makes the realtime adapter a pure edge change. The `(subject,thread)` key is natural — the decider already iterates recipient×thread to address rings — so this is **one enum variant**, not new structure. The swarm-fear / anti-anxiety property (§7.1, SPEC §2.5, BRAND) is preserved by the coarse v1 mapping: present crew get no SMS regardless of which state.
**Tradeoff:** v1 cannot fully suppress (§7.1's strongest form) — a crew member staring at a thread gets a redundant in-app toast rather than nothing. Accepted: it's an in-app badge, not a phone ring, and cancel-on-read + the live message cover it. `present_here` is dead code until realtime.
**Rejected:** two-state `present | absent` inside the decider (breaks DEC-047's zero-decider-change promise); decider-side timestamp classification (the here/elsewhere upgrade isn't expressible from a global timestamp).
**Revisit if:** DEC-047's realtime adapter lands — the edge begins emitting `present_here` and v1's full-suppression gap closes with **no decider change**.
**Phase:** Phase 6 (6.4).
