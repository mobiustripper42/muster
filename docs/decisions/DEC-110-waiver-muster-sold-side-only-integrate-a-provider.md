---
id: DEC-110
title: "Waiver — Muster-sold side only; integrate a provider (deferred pre-flip); pilot uses minimal consent"
topic: "Reservations & payments"
---

## DEC-110: Waiver — Muster-sold side only; integrate a provider (deferred pre-flip); pilot uses minimal consent

**Status:** Decided 2026-07-11 (Eric + @architect, under DEC-105). Direction set; provider + wiring
deferred ("decided at the last minute").

**Context.** A Xola replacement collects waivers. But waivers **don't feed the crew engine** (crew don't
need them, SPEC §0.4) — it's a self-contained, liability-grade capture-and-store, exactly the kind of thing
not to hand-roll. And it's needed **only on the Muster-sold side**: Xola bookings keep their Xola waivers
(collected when Xola sold the trip).

**Decision.** **Integrate a dedicated e-waiver provider** (Smartwaiver / WaiverForever / similar) — the
provider owns signature capture, legal enforceability, storage, and retention; Muster stores the
signed-waiver reference on the reservation. **Staged:**
- **Pilot (Phase 11):** a **minimal in-flow consent checkbox** + linked terms + consent timestamp; the
  operator collects the real signed waiver **by hand** for the ~5 bookings. Does **not** block the first
  live paid booking.
- **Before the public flip (Phase 12):** wire the provider. Which provider + integration shape is a
  **last-minute call** and a **Drew/Spink liability decision** (including whether an in-flow checkbox is
  ever legally sufficient). Do **not** build a native waiver subsystem. **Revisit if:** a provider can't
  meet retention/enforceability needs (then re-scope).
