#!/usr/bin/env bash
# Stop hook — nudge when the last assistant reply ran long. Non-blocking; silent under threshold.
# Reads the finished reply from the session transcript, counts words, and if over the
# threshold injects a one-line reminder the model sees before its next turn.
input=$(cat)
tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
[ -n "$tp" ] && [ -f "$tp" ] || exit 0
# Last assistant line that carries a text block (tool-use-only turns are skipped).
line=$(tail -n 400 "$tp" 2>/dev/null | grep '"type":"assistant"' 2>/dev/null | grep '"type":"text"' 2>/dev/null | tail -1)
[ -n "$line" ] || exit 0
text=$(printf '%s' "$line" | jq -r '[.message.content[]? | select(.type=="text") | .text] | join(" ")' 2>/dev/null)
[ -n "$text" ] || exit 0
words=$(printf '%s' "$text" | wc -w | tr -d ' ')
[ "${words:-0}" -gt 250 ] || exit 0
msg="Heads-up: your last reply was ${words} words. Tighten the next one — lead with the answer, cut padding/repetition/jargon, and never open with a guess about what the user did wrong. Long is fine only when every line is load-bearing."
jq -cn --arg m "$msg" '{hookSpecificOutput:{hookEventName:"Stop",additionalContext:$m}}'
exit 0
