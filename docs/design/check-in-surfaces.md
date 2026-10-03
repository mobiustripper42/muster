# Check-In & Waiver — Surfaces

Status: draft v0.8 · Fourteenth design artifact. Working name: **Muster**. Worked example: BrewBoat.
The **screens only**. Data model, build/buy and rationale live in `check-in-and-waivers.md`;
patterns copied from shipping products are sourced in `waiver-checkin-market-scan.md` (design chat,
not in this repo).

> **v0.8 changes — 2026-10-02, operator, speccing 18.6.** **B, A4, C1: an obvious duplicate counts
> once** and shows *×2* — the same name and date of birth within one booking. The mate's list makes
> it one row; for when it was two people, the row asks *Count this person twice?* with **Check in
> again** (2026-10-03, after a hand test: *+1 aboard* read as neither a button nor an action). **B**
> lives at `/b/<code>/party`.
>
> **v0.7 changes — 2026-10-02, operator, speccing 18.5.** **C1:** **Check in** sits in each
> departure's row on the shift card, and the passenger count starts at the number signed. **C2:** no
> brightness control until a native app. **C4:** nothing turns read-only after the trip. **A5:** a
> trip link stays good until the trip's day ends, boat time, not the scheduled minute — a boat held
> for weather still takes signatures (18.5b). **C1:** the untouched passenger stepper follows the
> signed count as it climbs (18.5b).
>
> **v0.6 changes — 2026-10-01, operator, after using 18.4.** **A1, A3: one form.** The *who are
> you signing for?* and *how many kids?* steps are gone. The page opens on the guest's details, and
> `+ Add a minor` under them adds a card at a time, each with a remove, up to ten. The guest reads
> *minor*, never *child* (2026-10-02).
>
> **v0.5 changes — 2026-09-29, operator, while building 18.2.** **Templates** (D): a scheduled
> version can be edited until it takes effect. **Roster mode is gone** from the settings (D) — a
> future idea. **A5 gains a throttled state** (2026-09-30, 18.3b). **A1: steps 3 and 4 are one
> page; A3: the parent always sails; A5: a no-waiver state** (2026-09-30, 18.4). The operator phone the A5 states
> name does not exist yet (issue #1140).
>
> **v0.4 changes — 2026-09-27, operator review.** Screen C gains a **passenger-count stepper**,
> independent of the ticks, and loses **"+ Not on the list"** — an unsigned walk-on is in the count
> and has no row. **The COI rule** replaces C3's over-capacity warning: nothing above the boat's legal
> limit is recorded or shown. **A5 no longer blocks a second signer** on the same phone or email.
> **Offline is out of this build** (C3, C4). **Reminder frequency is an admin setting** (B). **Links
> carry a token, not the event id** (A).
>
> **The mocks describe how the screens function.** They are built in Muster's existing look and feel
> (`app/globals.css`), not the mocks' styling.
>
> Earlier: v0.3 made the list the interaction; v0.2 put the agreement last in A.

Four surfaces:

| | Screen | Who | Where |
|---|---|---|---|
| **A** | Signing page | Guest | Their phone, anywhere |
| **B** | Party page | Booker | Their phone, days (or months) before |
| **C** | Check-in | Mate | Gangway, phone, one hand, whole party on the dock at once |
| **D** | Operator views | Drew | Desk |

A and C are the ones that matter. B is one page and punches above its weight. D is thin.

---

## Cross-cutting rules

- **Phone-first, all four.** D is the only one anyone opens on a laptop, and it still has to work on
  a phone because Drew reads it on a dock.
- **One column, no horizontal scroll, nothing important below the fold.**
- **Tap targets ≥ 48px** everywhere on C. Wet hands, sometimes gloves, a moving deck.
- **The COI rule.** No screen records or displays a passenger number above the boat's COI max
  (`check-in-and-waivers.md` §4a). Controls stop at the limit; nothing warns about it.
- **No destructive action is one tap.** Nothing on these screens deletes. The heaviest action is
  confirm-and-depart, and it is reversible until the event ends (§C4).
- **Every screen states its trip.** Boat · date · time, in the header, always. The most common
  real-world error is doing the right thing to the wrong departure — three cruises a day out of the
  same slip.
- **Copy is plain and second-person.** "You've signed." "Two people still need to sign."

---

## A. The signing page (guest)

One page. Arrives from a dock QR, a shared link, or the booking confirmation / manage page — always
carrying **an unguessable token for the trip**, never the raw event id.

### A1 — One form, and the agreement is the last thing on it

```
┌────────────────────────┐
│ BrewBoat · Sat 3:00 PM │
├────────────────────────┤
│ Your details           │
│ You must be 18 or older│
│ Full legal name [____] │
│ ☐ legal name           │
│ Date of birth          │
│ [Mon][D][Yr]           │
│ Email [____]           │
│ Phone (opt) [____]     │
├────────────────────────┤
│ Minor 1      ✕ Remove  │  one card per minor,
│ Minor's full name [__] │  none until added
│ Date of birth          │
├────────────────────────┤
│ [  + Add a minor  ]    │  gone at ten
│ For anyone under 18    │
├────────────────────────┤
│ The agreement          │
│ [the text, in page     │
│  flow]                 │
│ ☐ I agree + e-sign     │
│ [       Sign       ]   │
└────────────────────────┘
```

**The document goes last** (WaiverSign's order): the details on top, the agreement below them, Sign
at the bottom, all one page (operator, 2026-09-30) — one form to keep if the connection drops.

**No questions before the form** (operator, 2026-10-01, after using it). There is no *who are you
signing for?* and no *how many kids?*: almost every guest signs for themselves, and the two steps
stood between every one of them and the form. The page opens on the guest's details.

**`+ Add a minor`** sits under the details card. Each tap adds a card, `Minor's full name` + `Date of
birth`, with a **✕ Remove**; the button moves down to stay under the last card, and goes at ten, the
cap. This is a client island (DEC-147): a card appears with no round trip, and its name field takes
the focus; after a Remove the focus moves to the add button. Without JS the same button posts the
form, and it comes back with everything typed and one more card.

**The guest reads *minor*, never *child*** (operator, 2026-10-02). A parent of a sixteen-year-old
does not think *child*, and the rule is *under the age of majority*, which is what *minor* means.

**Ages are stated where they apply.** *"You must be 18 or older to sign"* under *Your details*;
*"For anyone under 18 coming with you"* under the add button. Both read the operator's age of majority.

**DOB is three selects, and the year range is constrained by the card.** The guest's year list
starts 18 years ago; a minor's card ends 18 years ago.

**Email required, phone optional.** Nothing verifies either.

**No forced scroll-to-bottom** on the agreement. The text sits in page flow above the button.

**No drawn signature.** Typed name + legal-name checkbox + consent checkbox.

**One consent checkbox, not two.** One plain sentence; the long-form e-sign consent language sits
behind a "what does this mean?" link.

### A2 — The party step

Only rendered when the event has **more than one reservation**, before the form. A private charter
has exactly one, so BrewBoat never sees this screen.

```
  Who are you here with?
  ┌─────────────────────────┐
  │  Smith · party of 4   › │
  │  Nowak · party of 2   › │
  │  Reyes · party of 6   › │
  ├─────────────────────────┤
  │  I'm a walk-up        › │
  └─────────────────────────┘
```

Surnames only, scoped to one trip. This list is why the link must be a token.

### A3 — Minors

- **Just the guest** — the details card, and no minor cards.
- **With minors** — the details card, then a card per minor added: `Minor's full name` +
  `Date of birth`. One signature covers all of them, up to ten.

**The parent always sails with the child** (operator, 2026-09-30), so a parent signs as themselves
and adds the kids, and counts toward the group on the success screen.

`is_minor` is computed from each DOB, never asked.

### A4 — The success screen (the most valuable screen in the system)

```
      ✓  You're all set, Fred

         BrewBoat · Sat Jul 18 · 3:00 PM

  ─────────────────────────────────────
    Your group: 14 of 16 signed
    Two people still need to sign.

    [   Share with your party   ]
          copies a link

    [   Sign for someone else   ]
          on this phone
  ─────────────────────────────────────
```

**`Share with your party` copies a URL to the clipboard**, for a text or group chat.

**`Sign for someone else`** starts a fresh form on the same phone — for the family or friends
passing one phone down the line at the dock.

### A5 — States

| State | What the guest sees |
|---|---|
| Someone already signed on this phone or email | Nothing different — **a fresh form, every time.** Each signing is its own record; a shared phone or email is normal (couples, families). |
| Event departed — **the trip's day is over, boat time** (operator, 2026-10-02: not the scheduled minute; a boat held for weather still takes signatures at the gangway) | *"This trip has already sailed."* + operator phone. No form. |
| Event cancelled | Same shape, cancellation wording. |
| Bad or expired link | *"We can't find that trip."* + operator phone. Never a stack trace, never a login. |
| No waiver posted yet | *"Waivers aren't open for this trip yet."* No form (18.4). |
| Too many opens from one connection | *"Lots of people are signing from this connection right now. Try again in a minute."* + **Try again**. Never "can't find that trip", and the trip is not looked up while throttled (DEC-189, 18.3b). |
| Connection drops mid-sign | Keep the typed values and retry. Never lose the input. |

---

## B. The party page (booker)

One read-only page. The single highest-leverage screen per hour spent building it.

```
  Your BrewBoat trip
  Sat Jul 18 · 3:00 PM

        14 of 16 signed

  ✓ Amy Nowak           ✓ Joe Dunn
  ✓ Carla Vance         ✓ Kyle Smith (12)
  ✓ Dana Smith          ✓ Lena Petrov
  ✓ Dmitri Volkov       ✓ Marcus Hale
  ✓ Fred Kowalski ×2    ✓ Nate Brooks
  ✓ Grace Kim           ✓ Priya Raman
  ✓ Robert Smith        ✓ Tom Reyes

  ─────────────────────────────
   2 people still need to sign

   [   Share the link   ]
  ─────────────────────────────
```

- **Every signed name is shown. Never a "… 10 more"** — the same rule as the crew list (§C1): the
  booker is looking for who is missing, and a folded name is one she cannot see.
- Reached from the confirmation and manage page, and from **reminders at the frequency the admin
  sets**.
- **Reminders stop the moment everyone has signed.**
- The unsigned two are a **number, never a guess at a name**.
- **Someone who signed twice shows once, *"Fred Kowalski ×2"*, and counts once** (18.6, operator
  2026-10-02 — the rule is §6 of `check-in-and-waivers.md`). The count is the success screen's
  (§A4), so the two pages never disagree.
- **At `/b/<code>/party`**, behind the booking's own code. It shows names, so never the trip link.
  When the trip's day is over (boat time, the trip link's rule) the names stay and **Share the link**
  goes; a cancelled booking or departure shows neither.
- No editing here. The booker chases people; she does not administer records.

---

## C. Check-in (mate, at the gangway)

The screen the product is actually for. One hand, bright sun, moving deck, the whole party standing
on the dock, two minutes before lines off.

### C1 — Layout

```
┌───────────────────────────────┐
│ ‹ BrewBoat · Sat 3:00 PM      │
├───────────────────────────────┤
│  6 CHECKED IN       16 SIGNED │
├───────────────────────────────┤
│  STILL TO BOARD · 10          │
│  ┌─────────────────────────┐  │
│  │ Amy Nowak             ○ │  │
│  │ Carla Vance           ○ │  │
│  │ Dmitri Volkov         ○ │  │
│  │ Fred Kowalski         ○ │  │
│  │ Grace Kim             ○ │  │  scrolls —
│  │ Joe Dunn              ○ │  │  never "…9 more"
│  │ Lena Petrov           ○ │  │
│  │ Marcus Hale           ○ │  │
│  └─────────────────────────┘  │
│                               │
│  ✓ Checked in · 6  tap to undo⌄│
├───────────────────────────────┤
│  PASSENGERS [–] 16 [+]  [ QR ]│
│  [ Confirm 16 aboard & depart]│
└───────────────────────────────┘
```

**The list is the interaction.** Tap a name, that person is checked in, the row leaves the list and
lands in the `Checked in` disclosure. Tap it there to undo. The list shrinks toward empty.

**The count is the mate's.** `PASSENGERS` is a stepper he sets, independent of the ticks: it covers
anyone aboard who never signed or was never ticked. It stops at the COI max. **It starts at the number
signed** — every person on a signed waiver, minors included, capped at the COI max — until a count
is confirmed, then at that count (operator, 2026-10-02).

**Reached from the shift card.** A **Check in** button sits in each departure's row of the manifest
(operator, 2026-10-02), so a shift with two trips has two lists, each with its own count. It opens
at any time, for confirmed crew on that shift.

- **Every signed name is shown. Never a "…9 more."** The list scrolls inside its own region.
- **`SIGNED` is read-only and climbs on its own** as people scan at the rail: the page re-reads
  itself while it is on screen, every 20 seconds by default, set from a dock test (DEC-192). An
  untouched passenger stepper climbs with it; once the mate touches it, it is theirs (operator,
  2026-10-02).
- **Alphabetical by the name as typed.** A just-signed row lands in place with a brief highlight.
- **Minors are their own row**: `Kyle Smith (12) · w/ Robert`, tapped like anyone else.
- **Someone who signed twice is one row**, `Fred Kowalski ×2` (18.6 — the rule is §6 of
  `check-in-and-waivers.md`). A tap ticks one signing, so one Fred never takes two seats, and
  `SIGNED` counts him once. If it was two people after all, the row in `Checked in` carries
  *Count this person twice?* with **Check in again**, which ticks the other signing; both then count. Tapping the row takes ticks back one
  at a time (operator, 2026-10-02).
- **Rows are ≥50px** with the whole row as the target.

### C2 — The QR sheet

`QR` opens a half-sheet, not a new page. Nothing else on it.

```
        [ ███ QR ███ ]

     Scan to sign — BrewBoat 3:00
              [ Done ]
```

A large black-on-white code, drawn on the server (DEC-191), so it is on screen even if the signal
drops. **No brightness control**: a web page cannot set the screen's brightness, so that waits for
a native app (operator, 2026-10-02). Open, the `QR` button moves to the foot of the sheet and reads
`Done`; Escape and a tap outside close it too, and it opens and closes with no JS. The guest scans
with their own phone and signs there. Behind the sheet, `SIGNED` climbs and their name appears in
the list, unticked, on the next re-read.

### C3 — States

| State | Screen |
|---|---|
| List empty | List replaced by *"Everyone's aboard"* and a check. |
| Nobody signed yet | Empty list, and the QR button is the biggest thing on the screen. |
| Some never show | Rows just stay. The mate departs with them unticked; they are no-shows, or duplicates too different to group (a retyped birth date). |
| Checked in reaches the COI max | Remaining rows go inert; the header reads *"Full · 16 of 16."* No warning text. Unticking frees a spot. The stepper also stops at the max. |
| A tap fails (no connection) | The row shows it didn't save, with a retry. A tap never silently vanishes. |
| After confirming | §C4. |

### C4 — Confirm and depart

One tap. No confirmation dialog — the button already says the number.

```
  ✓ 16 aboard · counted 2:58 PM by Mike R.

  PASSENGERS [–] 16 [+]   [ Update count ]
```

**The count is just the current number, and the mate can change it at any time** — before lines
off, or after (operator, 2026-09-29). Changing it replaces the number, the time and who counted;
no history is kept, and there is no undo because there is nothing to undo. Still capped at the COI
max.

**Nothing on this screen turns read-only after the trip** (operator, 2026-10-02). Ticks and the
count stay editable; the captain's official log, when it is designed, is the record that locks.

---

## D. Operator views

Thin.

- **Per-event** — count, signed coverage, who counted and when, exceptions. Reached from the event.
- **Day / week rollup** — counts by departure, and the no-show delta (`pax_counted` < booked).
- **Templates** — post new agreement text as a new version. A scheduled version has an Edit button
  until it takes effect; a version in effect has none.
- **Settings** — reminder frequency, age of majority.

Export is a date range → CSV, three tabs, per `check-in-and-waivers.md` §10.

---

## E. Deliberately not built

- **Offline mode.** A future idea (`check-in-and-waivers.md` §11).
- **Wallet passes.** Real work, zero effect on whether the boat knows who's aboard.
- **A crew-facing search box.** Sixteen names scroll in one region. Search is for operators with 200.
- **Per-guest photos.** Solves nothing and turns the phone into a camera at the worst moment.
- **A staff "add guest by hand" form.** If crew are typing guest names, the QR flow failed.
- **Any modal that can block departure.** See `check-in-and-waivers.md` §8.
