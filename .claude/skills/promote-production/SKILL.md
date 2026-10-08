---
name: promote-production
description: Promote the active trunk (`main`) to the `production` deploy branch via fast-forward merge, then push. Each promotion is a production release: dev projects patch-bump + tag the trunk here, then advance `production` to it (`/retro` owns the phase-close minor, `/bump-major` the major). Use when work on `main` is ready to ship. Requires `origin/production` to exist.
tools: Read, Edit, Write, Bash, Grep
---

You are promoting `main` → `production`. `main` is the always-active trunk and `production` is a downstream deploy pointer that Vercel (or whatever host) watches. Each promotion is a production release: this skill **patch-bumps + tags** the trunk (dev projects), then ff-merges `main` into `production` and pushes — the deploy moment. `/retro` owns the phase-close minor bump; `/bump-major` the major. A `main` HEAD that already carries a fresh `v*` tag (e.g. `/retro`'s minor) ships as-is, without a second bump.

## Step 0 — Sanity gates

**Production branch exists:**
```
git show-ref --verify --quiet refs/remotes/origin/production || echo "missing"
```
If `origin/production` doesn't exist (locally cached), STOP. Tell the user: "/promote-production requires an `origin/production` branch. This repo deploys straight off `main` — there's nothing to promote. To adopt a production branch: `git checkout -b production main && git push -u origin production`, then point the host's production branch at it." Do not proceed. Step 1 refreshes the cache from the remote regardless, so a stale local view that misses a freshly-created `production` is recovered after the user re-runs.

**Clean working tree:**
```
git status --porcelain
```
If non-empty, STOP. Tell the user: "Uncommitted changes — commit, stash, or discard before promoting." Wait.

## Step 0.5 — Run the project's pre-promote checks

Projects define their own pre-promote gates — a staging/preview QA confirmation, a "no unapplied migrations on prod" check, whatever must be true before shipping. These are project-specific, so they live project-side: **use the Read tool** on `.claude/CLAUDE-context.md` (`## Migration Protocol (project)`, plus any `## Pre-promote checks` section) — never a `sed`/`grep` one-liner — then run or confirm every gate listed there before continuing.

The common gate — **QA confirmation:** if the project deploys the trunk to a shared staging/preview environment, confirm it was actually QA'd against **this** release since the last merge. Ask the user: **"Has the staging/preview environment been QA'd against this release? (yes/no)"**

For any gate that fails or is unconfirmed (no QA, unapplied migrations, etc.), STOP — do not proceed. If the project documents no pre-promote checks, skip this step.

## Step 1 — Sync local refs

```
git fetch origin main production --tags
```

## Step 2 — Check ff-mergeability

A fast-forward is possible iff `production` is an ancestor of `main`. Check:
```
git merge-base --is-ancestor origin/production origin/main && echo "ff" || echo "diverged"
```

**ff:** continue to Step 3.

**diverged:** STOP. `production` has commits that `main` doesn't have (someone committed to `production` directly, or rebased). Show:
```
git log --oneline origin/main..origin/production
```
Ask: **"production has diverged from main. Options: (a) merge production into main first (preserves both histories), (b) abort and resolve manually. Which?"** If (a), guide the user through merging `production` → `main` on a branch (likely needs a PR into `main`), then ask them to re-run /promote-production once that lands. Never auto-resolve.

## Step 3 — Release the trunk (patch-bump + tag)

Each promotion is a production release. First, is there anything new to ship?
```
[ "$(git rev-parse origin/production)" = "$(git rev-parse origin/main)" ] && echo "nothing to ship"
```
If equal, STOP: "production is already at `main` HEAD — nothing to ship."

**Unversioned project** — no `package.json` at the repo root, **or one with no `version` field**. Check with `node -e "process.exit(require('./package.json').version ? 0 : 1)" 2>/dev/null || echo "not versioned"`. Skip the bump: `SHIP_TAG=$(git tag --points-at origin/main | grep '^v' | sort -V | tail -1)` — promote whatever tag is there, or none. Go to Step 4.

The gate is the `version` field rather than the file, because a repo can carry a `private`, version-less manifest solely to get a test runner and still have nothing to version.

**Ship-as-is:** if `main` HEAD already carries a `v*` tag (e.g. `/retro`'s minor or `/bump-major`, and nothing merged since), don't double-bump:
```
HEAD_TAG=$(git tag --points-at origin/main | grep '^v' | sort -V | tail -1)
```
If `HEAD_TAG` is non-empty, set `SHIP_TAG="$HEAD_TAG"` and go to Step 4.

**Otherwise, patch-bump on `main`** (release commits land on the trunk directly — same as `/retro` / `/bump-major`). Capture what's shipping first:
```
git checkout main && git pull --ff-only origin main
SHIPPING=$(git log --oneline origin/production..HEAD)   # PRs/commits this release ships
NEW_VERSION=$(npm version patch --no-git-tag-version | tr -d 'v')
```
Prepend a `CHANGELOG.md` entry (create it with a literal `# Changelog` header if absent; read first and STOP if the header isn't literal) after the header:
```
## [<NEW_VERSION>] - <YYYY-MM-DD>
- <one bullet per PR/commit in $SHIPPING>
```
Commit, tag, push the trunk:
```
git add package.json CHANGELOG.md
[ -f package-lock.json ] && git add package-lock.json
git commit -m "Release v<NEW_VERSION>"
git tag "v<NEW_VERSION>"
git push origin main
git push origin "v<NEW_VERSION>"
SHIP_TAG="v<NEW_VERSION>"
```

## Step 4 — ff-merge production → main HEAD

```
git checkout production
git merge --ff-only origin/main
```

If `git merge --ff-only` fails (rare race — `main` moved between Step 2's check and now), STOP. Surface the error and ask the user to re-run.

## Step 5 — Push

```
git push origin production
```
The release tag was pushed in Step 3 (or already on the remote for a ship-as-is / non-dev promote). Belt-and-suspenders — push it if the remote somehow lacks it:
```
[ -n "$SHIP_TAG" ] && git push origin "$SHIP_TAG" 2>/dev/null || true
```

If the `production` push fails, STOP. Surface the failure with full output. Local state is consistent (`production` advanced locally) but the remote isn't yet — retry the push once the issue (auth, network, branch protection) is resolved.

## Step 5.5 — Wait for the deploy to land

A push is not a deploy. A host can pull the commit and fail to build it, keep serving the old app, and look exactly like a success — CenterLine ran a day that way, its phone app calling a route the server did not have yet.

**Use the Read tool** on `.claude/CLAUDE-context.md` for a `## Post-promote checks` section — never a `sed`/`grep` one-liner. No section: skip this step silently, and Step 6 reports the deploy as not checked.

Each check there is one command that does its own waiting: it polls the host until the host reports the commit or tag just pushed, exits 0 when it does, and exits non-zero with its own message when it gives up. The project owns the polling and the time limit, because it knows its host; this step runs the command and reads the exit code.

Run every check, in order — a failure does not skip the rest, since each one reports on a different thing:

1. Say what it waits on, in one line, before running it — a check can take minutes, and silence reads as a hang.
2. Run it, with a tool timeout longer than the check's own limit. The Bash tool caps a call at ten minutes; a check whose limit is that long or longer runs in the background, and this step waits for it to exit.
3. Exit 0: **landed**. Anything else: **not landed** — name the check, pass on its output, and say where the section says to look (a deploy log, a dashboard). Never report a promotion as done when a check did not pass.

Never undo the push. `production` is where the operator asked it to be; a failed deploy is a host problem to fix forward, and reverting a ref behind a host that may be mid-deploy is a second incident.

## Step 6 — Summary

When any check did not pass, the reply opens with one line per failed check, above everything else — it is what changes what the user does next:

```
NOT LANDED — <check>: <its message>. Look at <where the section says>.
```

Then the summary:

```
Promoted main → production at <SHIP_TAG or short commit hash>
production now at <short commit hash>
Host deploy on `production` triggered (if the host watches the production branch).
Deploy: <landed | NOT LANDED (<failed checks>) | not checked>
```

`not checked` means the project has no `## Post-promote checks` section. Remind the user to verify the deploy by hand — open the production URL and confirm it shows the shipped version — and suggest adding a check, so the next promote waits for it instead.

**Branch hygiene:** do NOT delete `main` or `production` — `main` keeps accumulating the next batch of work; `production` waits for the next promotion. Both are permanent.
