---
id: DEC-146
title: "A filled seat retires its outstanding asks"
topic: "Seats, shifts & state machine"
amends_spec:
  - section: "1.2"
    scope: "the Tier-1 broadcast's losing recipients are retired as `withdrawn` when the seat fills, and carry no reliability event — the tier description implied the losers simply went stale"
  - section: "1.4"
    scope: "`ask_ignored` is only for genuine silence; an ask retired because its seat filled is `withdrawn` and scores nothing"
---

## DEC-146: A filled seat retires its outstanding asks

**Decision:**

- **When a seat is filled, every other outstanding ask on it is retired** —
  `respondedAt` stamped, `response: "withdrawn"`, **no reliability event**. Applied at all
  three fill doors: an accepted ask winning the CAS, a self-claim (`Asked` seats are
  claimable since #440), and the operator override.
- **`withdrawn` is not an answer.** It is distinct from the timeout marker
  (`respondedAt` set, `response` absent), which means "we waited and they said nothing" and
  carries `ask_ignored` at −3. The submittable subset of `AskResponse` is named
  separately (`AskAnswer`), so no crew-facing or operator-as-crew door can post it.
- **A withdrawn ask does not count toward the seat's asked-set**, so its recipient is
  re-askable when the seat reopens. One definition (`askedSetFrom`) shared by `widenAsk`
  and the tick's drip, which already assert by construction that they pick the same
  candidate.
- **A withdrawn ask remains answerable.** Retiring it stops the *sweep* from inventing
  a penalty; it is not a refusal of the crew member's own answer. A contested yes ten
  minutes late still logs `ask_accepted` (+2) per DEC-120, and their real answer replaces
  the marker.
- **It reads as itself, not as silence.** The cockpit pool shows a withdrawn candidate as
  **available** (they are re-askable, and the operator should get the assign affordance);
  the ask trail and the At-Risk trail carry `withdrawn` as its own outcome and its own
  count. The outbox "why" line skips it — it is not a negative signal.

**Why — and the root cause is not where the issue put it.** #600 proposed that "the absence
of a way to say nothing-happened is the root of the bug." It isn't, and the distinction
changes what the fix has to be. The decisive test is which single change alone fixes it:
add a nothing-happened value but keep closing only the winner's ask, and the bug is
**unchanged** — the losers are still live, `expireAsks` still finds them on reopen, still
stamps `ask_ignored`. Close the losers with *any* terminal marker and the bug is **gone**,
with no new vocabulary and no scoring change.

So the root is that **an ask's lifecycle was keyed to its own row and never to the seat's
state.** When the seat filled 51 seconds in, five asks were rendered moot and nothing
recorded it; their *liveness outlived their relevance*, and `expireAsks` then did
arithmetic on `sentAt` for a question that had stopped being askable nine days earlier.
The missing vocabulary is the third-order item — it is what makes the record truthful and
the score correct going forward, which is why this decision still adds it.

**Why not simply sweep the losers when the seat fills.** That was the shape the tick
already refused, on purpose: DEC-067 sweeps `Asked` seats only, precisely so a filled
seat's sibling asks are NOT stamped `ask_ignored`. That guard was correct and is why the
penalty was deferred rather than immediate. The fix belongs at the fill, where the
information is — not in the sweep, which cannot tell a moot ask from a ghosted one.

**All three doors, not just the ask path.** Fixing only `recordResponse` would leave the
identical bug reachable through self-claim and the override. This project has been bitten
by that shape repeatedly — the `/admin` hub's two hand-edited menus, the auth sweep's
duplicated kill-switch — so the retirement lives in one exported helper the three callers
share.

**And the first draft of this decision claimed that while one door was still open.**
`claimSeat` had no retirement call; the sentence above was aspiration written as fact. It
shipped green because the test named "a self-claim onto an `Asked` seat…" called
`manualOverride` — so the door that was claimed covered was the one door with no test at
all. Worth recording because the failure is not the missing call, which was a minute's
work: it is that **a test named after the behaviour it does not exercise is worse than no
test**, since it converts an unverified claim into an apparently-verified one. The
per-door tests now each call the function in their own name, and each was negative-
controlled by reverting its own door.

**Prod fallout was already written and is the operator's to clear.** 34 asks were armed on
filled seats, each one a latent unearned penalty, plus ~6 `ask_ignored` events already
logged (worst: 9d 0h 15m late). `db/ops/600-close-losing-asks.sql` carries the inspect →
disarm → verify sequence. Deleting the six breaks `reliability_events`' append-only rule
(DEC-008) deliberately: an append-only log earns its keep by being true, and those rows
record something that did not happen. The alternative — let them age out of the 40-event
window — costs weeks of mis-ordered asks nobody can attribute, at −3 each.

**A withdrawn ask is not an ask for the CURRENT gap.** The same rule the asked-set uses
also governs the warming board's signals, and getting there took a second review pass: the
escalation trail sums asks across *all* a shift's required seats, so a filled seat's
withdrawn losers made a shift read `asked > 0 && pending === 0` — "everyone answered and
we're still short" — while its other seat had simply never been tried. Before this change
those asks stayed live forever, so that shape was unreachable. The warming signals now key
on the unfilled seats only, and skip withdrawn asks there too; the displayed trail stays
whole-shift, because transparency (DEC-024) wants the full history even where the *signal*
does not.

**Tradeoff:** `withdrawn` is a fourth outcome every ask-reading surface must now handle,
and a surface that forgets it falls through to whatever its `else` branch is — which is how
these rows came to read "silent" in the first place. The type system covers the write side
(`AskAnswer`); the read side is covered by test, not by construction. **Rejected:** deleting
the losing ask rows (destroys the record that they were asked, which the trail needs);
sweeping at fill time via `expireAsks` (see above); treating `withdrawn` as closed to further
answers (silently deletes the DEC-120 contested-yes credit — three existing tests caught
this, and the tests were right). **Revisit if:** a fifth ask outcome appears, at which point
the read-side fall-through wants to become an exhaustive switch. **Phase:** 12.
