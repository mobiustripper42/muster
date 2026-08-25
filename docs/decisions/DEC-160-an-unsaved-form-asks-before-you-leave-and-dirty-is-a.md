---
id: DEC-160
title: "An unsaved form asks before you leave, and \"dirty\" is a comparison against the server's defaults"
topic: "UI, brand & frontend patterns"
---

## DEC-160: An unsaved form asks before you leave, and "dirty" is a comparison against the server's defaults

**Why this is a decision and not spec text.** The spec can say *"a half-filled form warns before
it is abandoned"* and should. What it cannot hold is the fork underneath: **what counts as
dirty**, and **which exits are guarded**. Both are live — each has an alternative that is cheaper,
that a future session will reach for, and that fails in a way nobody notices for months. That is
the condition for a decision rather than a spec line.

### Context

Issue #699 and issue #780 made a *refused save* keep the operator's work. Neither covered the
ordinary way it disappears: a half-filled form, a click on the master list inches away, gone with
no prompt and no trace. Every admin CRUD surface is master–detail, so the list that navigates
away sits beside the fields being typed into.

A guard already existed — `components/admin/dirty-submit.tsx`, from the time-clock work — on two
of the ten draft surfaces, welded to a disabled-until-dirty Save button the other eight must not
inherit (`Create` on an empty add-on form would render dead). It was never written up.

### Decision

**1. Ten surfaces are guarded, through one shared island.** `components/ui/unsaved-guard.tsx`
exports `useFormGuard` and a zero-render `<UnsavedGuard />` dropped inside any `<form>`.
`DirtySubmit` is now that hook plus a button, so there is one guard rather than two.

**2. Dirty is a comparison, not a flag.** The form's current values against the values it was
born with, both reduced to sorted `[name, value]` pairs (`components/ui/form-dirty.ts`).

*Rejected: a boolean set on the first `input` event.* Cheaper, and it answers a different
question — *has anything happened* — so it stays stuck on after a character is typed and deleted.
An over-eager guard gets muted by the person it is protecting, and this is the cheap option a
future session reaches for first. It is also what `DirtySubmit` did, so this decision changes
behaviour on `/admin/time-clock` and `/crew/time`: Save now re-disables when a punch is put back
as it was.

**3. The baseline is read from the server-rendered defaults, via a detached clone** —
`form.cloneNode(true)` carries *attributes*, which are the defaults, while what the operator has
typed lives in the DOM *property*, which the clone does not carry.

*Rejected: snapshotting the live form when the island mounts.* It is the obvious implementation
and it is a race: the island mounts at hydration, the form is typeable before that, and anything
entered in the window becomes the baseline — so the form reads clean and the guard stays silent
on real work. Exactly the bug the feature exists to prevent, arriving through the feature. It was
caught by a test on a compile-on-demand dev route, where the window is widest; on a prebuilt
server it would have shipped and shown up as "the guard sometimes doesn't fire."

The clone also settles the refusal case for free: after a refusal the defaults **are** the
operator's own values, because `app/lib/form-draft.ts` hands them back as defaults (DEC-147's
fourth rule), so the restored form is born clean and the guard does not nag about work it just
returned.

**4. Dirtiness is evaluated once at mount, not only on the next event.** An edit typed before
hydration fired its `input` event at nobody; without a mount-time evaluation the guard stays
blind to it until the operator happens to type again.

**5. Four exits, four mechanisms, because no one of them covers another.** `beforeunload` for
reload, tab close, the address bar and external links; a capture-phase `click` listener for
in-app anchors, which fire no unload; the shared registry in `components/ui/dirty-state.ts` for
`AutoSubmitSelect`/`AutoSubmitDate`, which navigate from a `change` handler and are not anchors;
and a history sentinel for Back and Forward, which fire neither.

**6. Back and Forward are prevented, not undone.** A duplicate history entry for the same URL
sits under the page, so a Back press lands on the sentinel with the form intact and the guard can
ask.

*Rejected: asking on `popstate` and calling `history.forward()` when declined.* Simpler, no
sentinel, and wrong: `popstate` fires **after** the browser has moved and Next has begun
rendering the previous route, so going forward again returns a form re-fetched from the server
with the typing gone. Undoing the move is not enough — it has to be prevented.

**7. The trap is page-level and refcounted, armed for the page's whole life.** There is one back
stack, so there is one sentinel however many guarded forms are mounted (`retainBackTrap` in
`components/ui/dirty-state.ts`). A pop with nothing dirty is consumed transparently — the handler
consents and re-issues the step — so arming early is invisible and one Back press still goes back
one page.

*Rejected: a sentinel per form, pushed when that form goes dirty.* It was the first cut and it
failed twice. Per form, a page with two guarded forms pushed two sentinels and unwound them
unevenly. Pushed on dirty, a value edited back and forth stacked one dead Back press per
transition — and worse, a Back press while the form was momentarily clean spent the sentinel
silently, after which the next edit re-armed nothing and the following Back walked out
unchallenged. Both found by `@code-review` before this shipped.

**7a. One question per click, not one per guarded form.** Two forms can be dirty at once
(`/crew/time-off` renders two side by side), and each armed guard has its own capture-phase
listener on the same click. Asking per listener showed two native dialogs back to back, and an
operator who confirmed the first could reflexively dismiss the second and find themselves blocked
on a page they had already agreed to leave. `confirmLeaveOnce` caches the answer on the event
identity, which is correct by construction because the dirtiness it consults is already page-wide.

**8. A plain `confirm()`, reaffirmed.** The alternative is a component with focus management and
its own failure modes, for a prompt that fires rarely and must not be dismissable by accident.
Operator, 2026-08-24, when the guard went from two surfaces to ten.

### What is not guarded, and why that is acceptable

**Without JS there is no guard.** The island never runs, every form still posts, and the operator
gets the previous behaviour. This is the status quo rather than a regression, and DEC-147 rule 2
is satisfied: the form needs nothing this island provides.

**Before hydration there is no guard either** — nothing can guard before it exists. The window is
widest on a cold route and is the same window in which no other island works.

**`/book/checkout` is excluded.** A customer mid-payment is a different problem with different
stakes; it is tracked as issue #776.

### See also

- **DEC-147** — server-rendering default and the rules this island is earned under; its fourth
  rule (a refused form's defaults come from the server, never from client state) is what makes
  point 3 work.
