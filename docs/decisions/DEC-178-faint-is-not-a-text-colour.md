---
schema: 1
id: DEC-178
title: "`faint` is not a text colour"
topic: "UI, brand & frontend patterns"
status: "active"
date: "2026-09-19"
ruling: "`--color-faint` keeps its value and loses its text role. Anything a person reads uses `--color-muted`. `faint` is for borders, `aria-hidden` decoration and `disabled:` states, enforced by lint across `app/` and `components/`."
claims:
  - kind: "file"
    target: "app/globals.css"
    note: "the token, its ratios, and what it is for"
  - kind: "file"
    target: "eslint.config.mjs"
    note: "FAINT_TEXT_SELECTORS — two, a className is written two ways"
  - kind: "file"
    target: "scripts/lint-ratchets.test.mjs"
    note: "proves it fires; the carve-outs stay quiet"
revisit_if: "A third text tier is needed between ink and muted — it gets a new token measured at 4.5:1, not a relaxation of this one"
---

## DEC-178: `faint` is not a text colour

`--color-faint` (`#93a0b0`) measures **2.36:1** on the page background and **2.66:1** on a
card. AA wants 4.5:1 for body text and 3:1 for large text; it clears neither, so no size or
weight rescues it. `--color-muted` passes at 5.18:1 / 5.83:1.

Issue #951 offered two answers: raise the value, or reclassify the token. Raising it collapses
`faint` into `muted` — the hierarchy flattens anyway, just with two names for one colour.
Reclassifying keeps it honest: the remaining uses are real. See also DEC-021, narrowed here.

**The lint rule is the decision, not the sweep.** 126 uses moved across 36 files, and one was
written in PR #1032 — new code, with this issue open and these numbers measured. `text-faint`
is the obvious class for "quieter than muted" and nothing about it announces the failure.

Three carve-outs, the first two WCAG's rather than preferences: text in an **inactive** control
is exempt (1.4.3), and **decoration with a text equivalent** is not text. A **border** is
neither. A placeholder is *not* carved out — it is read by the person deciding what to type.
