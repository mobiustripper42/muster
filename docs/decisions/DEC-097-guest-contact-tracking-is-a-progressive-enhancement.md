---
id: DEC-097
title: "Guest-contact tracking is a progressive-enhancement client island (#345 Part B)"
topic: "Crew, vessels & manning model"
---

## DEC-097: Guest-contact tracking is a progressive-enhancement client island (#345 Part B)

**Context.** The manifest's guest Text button preloads an intro SMS (Part A). Part B needs the tap to
**record who texted which guest**, so every crew member on the shift sees who's been contacted. A plain
`<a href="sms:…">` navigates straight to the phone's Messages app — there's no server round-trip to
hang a record on, and the DEC-026 default is *no client JS required*.

**Decision.** A contained **client island** (`GuestTextButton`, `"use client"`) that, on tap, fires a
best-effort `keepalive` POST to `/api/guest-contact` **and then lets the `<a>` navigate as normal**. The
server resolves *who* from the session (can't be forged) and upserts a latest-contact row per booking;
`buildShiftManifest` reads them so each guest shows "✓ Texted by <name> · <time>", shared across every
viewer of that shift.

**Why this is within the no-JS posture, not a break from it.** The tap is **never gated on JS**: with
scripting off, the same `<a>` still opens Messages with the intro preloaded — the recording is purely
additive enhancement. This is the same family as the existing `GetFormSubmit`/spinner client components
(DEC-026 allows client JS for *enhancement*, forbids it as a *requirement*). Data model: `guest_contacts`
(0020), upsert-latest by `reservation_id`, denormalized contacter name (no-FK read, DEC-DATA-1),
edge-written best-effort — never the domain.

**Known gap (accepted for v1).** The *sender* navigates away to Messages, so they see their own ✓ only
on returning + a reload; *other* crew see it on their next load (the cross-crew visibility that's the
point). An optimistic instant-✓ would need client state — deferred. **Revisit if:** the record needs to
be tamper-checked per-shift (currently any signed-in subject can post), or an append-only contact *history*
(who texted, how many times) is wanted over the latest-only state.
