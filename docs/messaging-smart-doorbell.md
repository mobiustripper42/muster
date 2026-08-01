# Messaging & the Smart Doorbell — Muster

Status: draft v0.1 · Thirteenth design artifact for the Xola-replacement.
Supersedes and absorbs `cohort-messaging.md` (the twelfth), which sketched cohort *broadcast*
before the full-mesh group model and the Smart Doorbell were worked out. Companion to
`crew-app-surface.md`, `shift-state-machine.md`, the channel abstraction (DEC-MSG-1),
`coexistence-rollout.md`, `customer-portal-sketch.md`. Worked example: BrewBoat.

**Priority note:** elevated above the reservation/customer work. This is a near-term build —
post-pilot, shipping with the live crew app — not a Tier-4 deferral. May enhance the crew
engine (§13); does not modify its locked spec.

---

## 1. The reframe that cracks it

The thing that made this hard to see: it looked like a *messaging* problem. It isn't.

- **The group chat is the easy part.** Threads, any membership, everyone-to-everyone, full
  history — that's software Muster fully owns: a store of messages, a participant set per
  thread, a web UI, a live connection. Building it to *any* combination is a solved problem.
- **The hard part is notifying the phone** — the starting delivery channel is SMS (native push
  stays a live option, §7.0/§14), and SMS is dumb: one stream, one ring per message.

So this doc is two organs: the **in-app messaging model** (threads in Muster), and the
**Smart Doorbell** (the notification engine that decides when a phone rings). The Doorbell is
the actual design work.

---

## 2. Vocabulary

- **Shift** — one boat, one day; two seats (captain + mate). The crewing unit. *Too small a
  word for day-wide messaging* — the source of earlier confusion.
- **Cohort** — everyone crewing on a given **day**, gathered across every shift that day.
  Saturday's cohort = all six. Derived from the schedule, not a saved list.
- **All-staff** — the entire roster. Standing membership.
- **DM** — any two people, one-to-one. Ad-hoc.

All four are the **same primitive: a thread + a participant set.** Membership is *derived*
(cohort, shift), *standing* (all-staff), or *ad-hoc* (DM). Model general, seed minimal.

---

## 3. Requirements (locked)

- **Full mesh.** Everyone can talk to everyone — real group messaging, not broadcast-only.
- **Cohort** message — everyone working a day, one shot.
- **Shift** thread — the crew of one shift.
- **All-staff** — the whole roster, one shot.
- **Ad-hoc DM** — a crew member taps another person on their shift and messages them **without
  knowing or sharing a phone number** (§6).
- **Quality bar: RCS-grade** seamlessness. (As the *bar*, not the solution — RCS can't host it,
  §4.)
- **Native apps: a preference to avoid, not an exclusion.** Ship SMS-first; native push is an
  additive delivery option (§7.0, §14), never a precondition. The one channel genuinely off the
  table is **web push as primary** — unreliable on iOS.

---

## 4. The core decision: threads live in Muster, SMS is the doorbell

On a phone, a "thread" can live in exactly two places: **the carrier** (SMS/RCS) or **an app
with push** (iMessage, native, web-push). There is no third place. The requirements in §3 knock
out every route where the *phone* owns the group:

- **Group MMS** (carrier-owned groups) — real on the phone, but static, fragile, US/Canada-only,
  unlabeled, and "every combination + ad-hoc DM" would spawn dozens of messy carrier threads.
  Wrong backbone.
- **RCS** — its group chat is a **person-to-person feature, explicitly not part of RCS for
  Business**. A business sender literally cannot host an RCS group. RCS could only ever prettify
  the 1:1 doorbell — never be the chat.
- **Native apps** — not a thread-ownership question. A native Muster client would still read
  Muster's threads; native is a *delivery channel* choice for the doorbell (§7.0), not a rival
  place for the group to live. Preference is to avoid it; it is not excluded.
- **Web push as primary** — off the table as the *primary* channel (unreliable on iOS without
  home-screen install); fine as a best-effort adapter where it works.
- **Twilio Conversations** — its one magic trick is merging SMS-and-app replies into one thread
  *when SMS is the conversation channel*. Here SMS is only a doorbell, so Conversations would
  manage threads Muster already manages, and it does **not** fix the one-stream-on-phone reality.
  Not needed; plain Programmable Messaging carries the doorbell.

**Decision: Muster owns the threads. SMS is a notifier, not the conversation channel.** The
talking happens in the Muster web app (tap the link → into the thread) — the same tap-a-link
move as the pilot. This is what lets full-mesh group chat exist without *depending on* native apps.

---

## 5. The phone reality (stated honestly) → sender-number topology

SMS has **no threads on the phone.** Every message from a given number stacks into one
undifferentiated stream. Threads exist only inside Muster; on the handset it's one "BrewBoat"
text stream. That separation — sorted in Muster, flat on the phone — is exactly what the app
buys that bare texting can't.

Consequence (Spink's explicit requirement): **scheduling SMS and message-notification SMS must
land as separate threads on the phone.** Since the phone threads by *number*, that means two
sender identities:

- **Scheduling number** — the crew **ask** (yes/no), call-time/dock changes (`crew-app §1`).
- **Doorbell number** — "new message in Muster, tap to open."

Two numbers → two clean streams on the handset. (Both ride the registered crew campaign, §12.)

---

## 6. The number-privacy property falls out for free

The ad-hoc DM requirement ("text the new mate without her number") needs **no number-sharing
mechanism at all** — because in this architecture *nobody ever texts anybody's real number*.
All talking happens in Muster threads; the doorbell only notifies. A crew member taps a crewmate
on the shift card, Muster opens a DM **thread**, the crewmate gets a doorbell ping. No personal
number is ever exposed to anyone.

Like the autonomous last-minute booking in the crew engine, this is the tell the architecture is
right: a hard requirement solves itself as a side effect of the model.

---

## 7. The Smart Doorbell (the notification engine)

Policy/mechanism, same as the oracle and refund engine: a **generic notification rule engine**
is the mechanism; the windows and priorities are **tenant config**. The rules, in order of how
much work they do:

### 7.0 Channel-agnostic: the doorbell decides, the adapter delivers
Split the question in two. **Whether and when to ring** — are they looking, batch it, has it been
read, is it urgent — is the doorbell's job: *policy*, and it's about human attention, not about any
one channel. **How the ring travels** once the doorbell says "ring" is a swappable **delivery
adapter**: SMS today, native push if you ever go native, best-effort web-push where it works. The
adapters sit beneath the doorbell on the channel-port seam already built (DEC-MSG-1).

Native swaps the *pipe*, not the *logic*. The proof: iMessage and Slack have flawless push and
*still* won't notify the thread you're staring at, still batch, still go quiet when you're active.
That suppression is platform-independent — so the doorbell is permanent, worth building well now,
and the web's iOS push unreliability is a property of one **adapter**, not of the doorbell. Native
push, when/if added, mainly buys reliable lock-screen/background delivery the web fumbles on iOS;
the deciding logic above it doesn't change.

### 7.1 Presence suppression — the keystone
**Don't ring anyone who's already looking.** If a crew member has Muster open with the thread in
front, messages appear live and **no SMS goes out to them**. The doorbell only rings people who
*aren't* watching.

Sit with what this does to the swarm fear: the people generating all the chatter are the ones in
the app — they get **zero** texts. Only the absent get pinged. Six-people-blow-up-everyone's-phone
**structurally can't happen**, because the people making noise don't need telling.

- "Present" is **narrow**: live connection **+** tab focused **+** in *that* thread. No fuzzy
  "kinda online." Fail toward ringing — pinging someone present is harmless; silence on someone
  absent is not.
- The server knows *which* thread they're in → hush **only that thread**, not all of Muster.

### 7.2 Delay-to-batch (+ the cancel window)
A notification doesn't fire instantly — hold **90 s** (default, `DOORBELL_BATCH_WINDOW_MS`; DEC-060)
and group multiple messages into one ping ("3 new in Saturday cohort," not three rings). The delay
doubles as a **cancel window**: if they open and read within it, the pending text is cancelled — no
ring at all. Priority messages (§7.4) bypass the hold entirely.

### 7.3 First-only-until-read
Ring on the **first** unread message in a thread; suppress further rings for that thread until
they've read something. Don't keep nagging an unanswered thread.

### 7.4 Priority — earn the right to ring now
Some messages jump the line: a shift change / "dock moved" rings through immediately; chatter
("lol same") waits and batches. Priority is a property of the message (operator-flagged, or
derived from type).

### 7.5 Short-notice-as-text
For a brief operational message, the SMS body **carries the content** ("slip B, call 12:30") —
no app trip needed to read it. The doorbell and the message collapse into one for short ops notes.

### 7.6 In-app toast (the doorbell's in-app twin)
If they're in Muster but *not* in that thread, multiple messages surface as an **in-app toast /
badge** — not an SMS. Present means no text, but they still notice.

**Combined effect:** noise-makers are in the app (silent); only the absent get pinged, deduped,
batched, and only when it matters.

---

## 8. How presence works (technical)

A **websocket** — the same live pipe that delivers messages instantly — also signals presence.
Open + focused = present; dropped = away. Trustworthy precisely because it means "looking right
now, this second," with no fuzzy online state to guess wrong. If the socket isn't solidly open,
treat as away and ring.

---

## 9. Runtime walkthrough — Saturday morning

1. Spink opens Muster, picks Saturday, posts to the **cohort thread**: *"Dock's at slip B today,
   call 12:30."*
2. Crew **in the thread** see it appear live — no SMS. Crew **in Muster but elsewhere** get an
   in-app toast (§7.6). Crew **not in the app** get a **doorbell SMS** (delayed/batched/priority
   per §7).
3. A pinged crew member taps the link → lands in the cohort thread.
4. They reply **in-app**, or for a short note the **SMS body itself** carries it back. Either
   way, the reply lands in the **one Muster thread**.
5. Everyone's messages — operator and crew, text and app — sit in that single sorted thread.
   Spink watches one conversation, not six scattered text chains.

This is the operational view Xola can't produce: it thinks a booking is done when money clears;
it has no concept of a day's crew, let alone a thread for them.

---

## 10. The in-app messaging surface (lean, per crew-app ethos)

Insultingly small, same as the rest of the crew app:

- **Thread list** — cohort (today), your shift(s), all-staff, your DMs. Past stuff hidden.
- **Thread view** — messages + a compose box. That's it.
- **Start a DM** — from a shift card's crew list: tap a crewmate → thread (§6).
- **Operator/admin** — the same threads, plus posting to cohort / all-staff, and visibility
  across everything.

---

## 11. Customer side — design in mind, build later

Same doorbell, **different door.** A customer only ever has one context: their trip. So customer
messaging is the same SMS-notification-into-the-app, but the link opens their **reservation /
living-link page**, not a thread list. Anything about the trip (delay, dock, "we're a go") shows
there; replies route to the operator.

- Likely not a thread *list* for customers — one trip, one place (thread shape per trip TBD).
- **Waits on the reservation system** (Tier 4); **consent-gated to the customer campaign**, not
  the crew campaign. Don't build now — but the doorbell model is designed assuming it.

---

## 12. Twilio / 10DLC fit

- Doorbell SMS rides the **registered crew A2P campaign** via plain **Programmable Messaging**.
  Conversations not required (§4). The SMS sender is **one delivery adapter** beneath the doorbell
  (§7.0) — a native-push adapter drops onto the same DEC-MSG-1 seam later without touching the
  doorbell logic.
- **Two sender numbers** for the phone-thread separation (§5) — both under the crew campaign.
- Customer doorbell waits on the **customer campaign** (§11).
- STOP still applies: an opted-out crew member is unreachable by SMS → Muster treats opt-out as a
  reachability flag (also relevant to the crew engine's asks).

---

## 13. Relationship to the crew engine & the auto-emit organs

Keep the organs distinct:

- **Auto-emit** (existing) — record/state changes → manifest refresh + material-change pings →
  crew. System→crew, structured, no prose.
- **Messaging** (this doc) — crew ↔ crew ↔ operator conversation. A new, human-prose organ.

**Potential crew-engine enhancements (parked — do not bolt into the locked spec):**
- Presence as a **reachability signal** for asks (don't rank someone you can't reach / isn't
  looking).
- The thread as the **home for the ask history** and day-of coordination on a shift.
- If read/presence data ever feeds the reliability score → honor the **Goodhart guardrail**: it
  arms judgment, never auto-pays. Most likely it stays out of the score entirely.

Note the seams; don't widen the crew spec yet.

---

## 14. Deferred / open

- ~~Exact **delay window** (~1 min)~~ — **resolved (DEC-060, 6.3):** batch/cancel **90 s**
  (`DOORBELL_BATCH_WINDOW_MS`), presence-staleness **5 min** (`DOORBELL_PRESENCE_WINDOW_MS`);
  env-overridable, tune on real use. The batch/priority *rules* (ordering, what flags as priority)
  remain 6.4's to compose.
- **DM privacy** — is a crew-to-crew DM private to the two, or operator-visible for ops? Decide.
- **Presence edge cases** — multiple devices, flaky connections, app backgrounded vs closed.
- **Read receipts / typing** in-app — nice-to-have, not v1.
- **Native push later** — purely additive: a delivery adapter beneath the doorbell (§7.0) that
  buys reliable lock-screen/background notifications the web fumbles on iOS. Swaps the pipe, not
  the doorbell logic; a preference to weigh, never a prerequisite.
- **Customer thread shape** (§11) — one rolling trip thread vs. per-message — defer to the
  reservation build.
- **Short-notice-as-text** (§7.5) — length threshold / which message types qualify.
- **Notification rules as tenant config** — the generic engine is built; per-tenant windows and
  priorities are policy (other operators will want different defaults).
