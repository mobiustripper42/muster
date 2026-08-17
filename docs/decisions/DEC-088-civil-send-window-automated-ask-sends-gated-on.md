---
id: DEC-088
title: "Civil send window — automated ask sends gated on vessel-local wall-clock; state advance is not"
topic: "Staffing engine — asks, escalation, At-Risk board & cockpit"
---

## DEC-088: Civil send window — automated ask sends gated on vessel-local wall-clock; state advance is not

**See also** — decisions this one changed part of:
- Refines DEC-063

**Status:** Decided 2026-07-04 (@architect gate, Phase 9.9, #235).

**Decision:** New tenant constants `CIVIL_SEND_START`/`CIVIL_SEND_END` (`src/config/tenant.ts`,
env-overridable "HH:MM", defaults 08:00/20:00, half-open [start,end) per DEC-083; bad format or
inverted pair degrades to defaults per the envMs posture — never throws, never silences the engine).
`withinCivilWindow(now, tz)` compares vessel-local wall-clock (DEC-032, Intl-based, DST-immune).
Outside the window the engine's OWN initiative defers: `tick()` skips its entire ask-firing block
(drip, blast, Tier-2 escalate) while still advancing state, sweeping DEC-067 timeouts, and detecting
board landings; `bail()`/`vacateSeat()` skip the inline re-ask and rest a non-exhausted seat at
**`Open`** (occupant cleared, `shift_bailed` still logged), which the next in-window tick's drip
picks up naturally (`widenDue(Open)` → immediate) — no queue; the idempotent tick IS the retry.
Exhausted-pool bails rest `Bailed` → AtRisk unchanged. **Gate the initiative, not the primitive:**
operator-explicit sends (cockpit ask, lean, `assignFromPool`, override) and crew-initiated responses
stay ungated. The gate sits at ask MINTING, never the transport — an `Ask` row implies a send, or
DEC-067 logs `ask_ignored` against messages never delivered (DEC-008 poisoning).

**Scope:** asks only. DEC-084 notices + DEC-068/073 rings still fire at any hour (incl. the 3am Xola
pull's cancel notices) — tracked as **#247, a blocker for production Twilio credentials**; notices
need an urgency-aware rule (a 23:00 cancel of an 08:00-call trip must not wait for the window), not
this gate.

**Refines:** DEC-022/062 (runway = existing horizon, untouched; the window gates sends only), DEC-063
(drip resumes in-window; a deferred bail re-crew now rides the drip instead of the inline pool blast),
DEC-067 (silent clock runs through the close — latest expiry ~21:45 with defaults), DEC-023 (tick
stays pure; window passed via opts). Supersedes #157's parked "civil window" note. Test suites hold
the window WIDE OPEN via env (vitest + playwright configs) — their clocks are arbitrary instants; the
gate is tested with explicitly injected windows.

**Revisit if:** urgency should override civility (a pre-call-time bail waits for 08:00 — the board
still pings and every operator path stays ungated, so the human handles the emergency); the silent
clock should pause overnight or sends should buffer before close; a tenant needs an overnight window
(night fleet).
