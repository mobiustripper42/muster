---
id: DEC-014
title: "Locked-spec + future-ideas discipline"
topic: "Core architecture & engine mechanics"
---

## DEC-014: Locked-spec + future-ideas discipline

**Decision:** `docs/SPEC.md` is **frozen at v1.0**. No new features or scope go into it. New ideas —
however good — land in `docs/FUTURE_IDEAS.md` and wait. The only edits permitted to the locked spec
are *corrections* and downstream feedback about existing behavior. Unlock only with a deliberate
version bump (v1.1) when a batch is genuinely ready.
**Why:** Stops the baseline drifting one shiny idea at a time at 11pm; lets a new idea be caught
without derailing the build (SPEC lock rule; FUTURE_IDEAS preamble). (Project-setup decision,
2026-06-03; muster-local — not backported to seeds this round.)
**Tradeoff:** Genuinely good ideas wait for a batched v1.1 rather than landing immediately.
**Revisit if:** The vertical slice has run a real BrewBoat weekend and a batch is ready to fold in.
