# Handoff — issue #699: a validation error destroys the typed form (all 4 admin CRUD surfaces)

**Status:** this branch (`task/699-controlled-state-spike`) is a **dead end kept for evidence**. It is
not proposed for merge. The real fix restarts on `task/699-form-error-keeps-your-work`, cut fresh
from `main`, carrying only the e2e spec.

**What we want a second opinion on:** whether the diagnosis this branch was built on is correct, and
what the right React 19 fix actually is. Everything below is measured in a real browser tonight
unless explicitly labelled a hypothesis.

---

## 1. The reported bug

Creating a new offering in `/admin/offerings`. A legitimate validation error (an incomplete price
variation). Instead of redisplaying the form with the error, **the form was replaced with a different,
pre-existing offering's data and everything typed was gone.**

Reported by the operator as: *"the error was mine; the data loss was not."*

Three distinct failures were stacked:

1. The error redirect emitted `sel=` (empty), because a new record has no id — so the page no longer
   knew a creation was in progress.
2. Not knowing, the record lookup fell through `?? visible[0]` and **substituted an unrelated record**.
3. The redirect itself remounted the form, discarding every uncontrolled input.

Defects 1 and 2 are understood, fixed, and independently proven. **This handoff is only about 3.**

## 2. The stack

- Next.js `^16.2.7`, React + react-dom `^19.2.7`, App Router.
- The four admin CRUD surfaces (`offerings`, `vessels`, `locations`, `add-ons`) are Server Components
  with `export const dynamic = "force-dynamic"`.
- Each page is ONE `<form>` spanning a header (with the submit button) and a detail card, posting to a
  `"use server"` action. Master–detail via `?sel=<id|new>`.
- The form carries `key={creating ? "new" : selected?.id ?? "none"}` so switching records resets the
  card. **That key was doing double duty** — "reset the form" AND "which record is this" — and a
  validation error tripped the second meaning.
- Originally the fields were uncontrolled (`defaultValue` / `defaultChecked`) and the action
  `redirect()`-ed with an `?err=` code on refusal.

## 3. What this branch did

1. Added `components/ui/action-form.tsx` — a small client island using `useActionState`, so a refusal
   is **returned** rather than redirected. Fields still arrive as `children` (server-rendered).
2. Converted every field on all four surfaces to **controlled** `useState` — ~19 fields on offerings,
   4–6 on each of the other three.
3. Changed all four actions to the `useActionState` shape: `(_prev, formData) => Promise<Err | null>`,
   returning the code on refusal and redirecting only on success. On the refusal path they also stop
   calling `revalidatePath` (nothing was written, and revalidating refreshes the RSC tree).

## 4. Measurements (all in a real browser, Playwright, dev server)

| # | Experiment | Result |
|---|---|---|
| A | Uncontrolled field (`defaultValue`), `ActionForm` in place, **no navigation** at all | **Value lost.** Comes back empty. |
| B | Controlled field (`value` + `onChange`), same conditions | **Value survives.** |
| C | Controlled **checkbox** (`checked` + `onChange`), same conditions | **State lost.** Probed directly: `checked === true` with React attached immediately before submit; `unchecked` after the refusal returns. |
| D | Same as C on the **offerings** surface, which we had already declared fixed | **Also lost.** The `weekday` box ticked before the refusal is cleared. Its original test only asserted text fields, so this went unnoticed for hours. |
| E | Text / textarea / `<select>`, controlled, all four surfaces | Survive. |

So: **text and select values survive when controlled; checkbox state is lost whether controlled or
not; everything is lost when uncontrolled.**

Note on D: on `add-ons` this is worse than blanking, because `active` defaults **on**. A refusal
doesn't empty it — it flips it back to `true` after the operator deliberately turned it off. A control
that resets to a non-empty default is far harder to notice than one that resets to empty.

## 5. The two competing explanations

**Hypothesis 1 — what this branch was built on (now doubted).** Next refreshes the route's RSC payload
after a server action, and under `force-dynamic` that is a full re-render which resets uncontrolled
inputs even though nothing navigates. Therefore the value only survives if React holds it. This is
asserted, in prose, in the header comments of `app/(admin)/admin/offerings/offering-sections.tsx` and
each of the new `*-card.tsx` files on this branch.

**Hypothesis 2 — what the evidence now suggests.** React 19 resets the form's DOM after a form action
completes. That single mechanism explains all five rows above:

- uncontrolled fields → reset to their `defaultValue` (row A)
- controlled text/select → React re-asserts `value` on its next render, so the reset is invisible (rows B, E)
- controlled checkboxes → the reset clears `checked`, but **React state never changed**, so there is no
  re-render and nothing ever re-asserts `checked` (rows C, D)

If Hypothesis 2 is right, controlled state was never the fix — it is a workaround that happens to cover
the field types React re-asserts, and silently misses the ones it doesn't. The real fix would be at the
form-submission layer, would cover every control type uniformly, and would make the ~19-field
conversion on offerings unnecessary.

## 6. The questions we want answered

1. **Which hypothesis is correct?** Is the post-action form reset a React 19 behaviour, a Next.js
   behaviour, or both? Does it apply to `useActionState`'s dispatch used as `<form action={formAction}>`
   the same way it applies to passing a server action directly to `<form action>`?
2. **What is the sanctioned way to keep submitted values on a refusal?** Is there an opt-out of the
   automatic reset, and is `requestFormReset` from `react-dom` related to it (it appears to *request* a
   reset, which implies the automatic one is the default — we have not verified this and are explicitly
   not guessing)?
3. **Is holding ~19 fields in `useState` the intended pattern here at all**, or is it fighting the
   framework? If the reset can be prevented, uncontrolled fields with `defaultValue` would survive and
   the whole conversion is unnecessary.
4. **If controlled state IS the answer**, what is the correct way to keep a controlled checkbox's DOM in
   sync when the reset happens without a state change? Anything that re-asserts on every render, or
   forces a re-render after the action, would do — but we want the idiomatic one, not the one that
   happens to pass a test.
5. **Are we wrong that a server round-trip can't do this?** If the refusal returned the submitted values
   and the fields were re-rendered from them server-side, no client state would be needed at all. Is
   that better here than an island? The house rule (DEC-147) is that server rendering is the default and
   islands must be earned.

## 7. Constraints that any answer has to respect

- **No-JS posts must keep working.** These are progressively-enhanced forms; the action is passed
  un-bound so React can enhance it. A fix that only works once JS has loaded is a regression.
- **Islands stay small (DEC-147 rule 2).** A page-sized client component is explicitly disallowed. The
  current branch keeps the island to one card per surface — a fix that turns a whole page into a client
  component would be rejected on those grounds.
- **`/admin/**` is on the money-computed trigger list.** Offerings define pricing. Whatever lands here
  gets a careful review and probably `/security-review`.
- Muster uses **native inputs** throughout — there is no component library forcing controlled state.

## 8. What is worth keeping from this branch

`e2e/admin-form-error.spec.ts` — five tests, each watched failing for its own reason before any fix
existed, and each triggering a **server-only** refusal (every one of these forms marks its fields
`required`, so the obvious refusals never reach the action — the browser blocks the submit and the test
would measure nothing). A single space clears `required` and fails the domain's `.trim()`; a
non-numeric amount clears a text input and fails the parse. The checkbox assertions in it are what
caught row D.

That spec is being carried to the new branch as its first commit. Everything else here is evidence.
