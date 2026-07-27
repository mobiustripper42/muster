---
id: DEC-059
title: "`main` stays promotable — multi-PR features land on a feature branch, not piecemeal on `main`"
topic: "Deployment, infra & versioning"
---

## DEC-059: `main` stays promotable — multi-PR features land on a feature branch, not piecemeal on `main`

**Decision:** Amends DEC-S022. `main` must be **promotable to `production` at any moment** — every commit on it production-safe. A feature that ships across **multiple PRs and isn't independently releasable** (e.g. Phase 6 messaging) does **not** land on `main` in pieces. It lands on a long-lived `feature/<name>` branch off `main`; its task PRs target *that* branch; it merges to `main` only when the whole feature is prod-ready **or** is dark behind a flag (the `app_settings` engine-pause and `VERCEL_ENV` dev-link gate are the in-repo precedents). Independently-shippable tasks still PR straight to `main` as before.
**Why:** DEC-S022 made `main` the always-active trunk and `production` a fast-forward-only deploy pointer — but never stated the precondition that *makes* an always-active trunk safe to deploy: that it stays releasable. Without it, incomplete features accumulate on `main` and a promote is forced to choose between shipping WIP or freezing prod. Hit for real 2026-06-25: `production` had drifted 16 commits behind `main` with Phase 6 messaging half-built on it, and a one-line horizon-constant change couldn't reach prod without dragging the messaging substrate along. The ff-only model has no cherry-pick escape hatch by design, so the discipline must live upstream of `main`.
**Tradeoff:** Long-lived feature branches reintroduce the big-merge / rebase cost the shell's small-PRs-to-`main` default deliberately avoided — accepted, because the alternatives are worse: flag-everything is more per-feature plumbing, and cherry-pick-to-prod breaks the ff-only invariant. Mitigate drift by merging `main` *into* the feature branch periodically, never rebasing a shared base.
**Revisit if:** the project moves to genuine continuous deployment with feature flags as the standing norm (dark-on-`main` then replaces the feature branch), or `production` is retired.
**Backport:** this is a gap in the shared seeds workflow, not Muster-specific — backport to the DEC-S series + the shell `## PR Workflow` via `/push-seeds`.
