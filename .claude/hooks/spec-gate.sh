#!/usr/bin/env bash
# PreToolUse hook (fires only on `git checkout -b`, via the `if` filter in settings.json).
# Non-blocking: the branch cut proceeds; this just re-anchors the target before code starts.
jq -cn '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:"New task branch. Before writing code, confirm with the user what \"done = X\" looks like for this task — the concrete end-state, which surfaces it touches, and the success check. If any of that is ambiguous, ask ONE clarifying question first; do not build silently on an assumption."}}'
exit 0
