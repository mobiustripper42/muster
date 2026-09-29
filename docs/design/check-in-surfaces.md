# Check-In & Waiver — Surfaces

Status: draft v0.4 · Fourteenth design artifact. Working name: **Muster**. Worked example: BrewBoat.
The **screens only**. Data model, build/buy and rationale live in `check-in-and-waivers.md`;
patterns copied from shipping products are sourced in `waiver-checkin-market-scan.md` (design chat,
not in this repo).

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

### A1 — Four steps, and the agreement is the last one

```
   step 1                 step 2                step 3               step 4
┌──────────────┐      ┌──────────────┐     ┌──────────────┐    ┌──────────────┐
│ BrewBoat     │      │ BrewBoat     │     │ BrewBoat     │    │ BrewBoat     │
│ Sat · 3:00PM │      │ Sat · 3:00PM │     │ Sat · 3:00PM │    │ Sat · 3:00PM │
├──────────────┤      ├──────────────┤     ├──────────────┤    ├──────────────┤
│ Who are you  │      │ How many     │     │ Your details │    │ Voyage       │
│ signing for? │      │ kids?        │     │              │    │ Agreement    │
│              │      │              │     │ Full legal   │    │              │
│ ┌──────────┐ │      │ (1) (2) (3)  │     │ name         │    │ [the text,   │
│ │ Myself   │ │      │ (4) (5) (+)  │     │ [_________]  │    │  scrollable, │
│ │  18+     │ │      │              │     │ ☐ legal name │    │  in page     │
│ └──────────┘ │      │              │     │              │    │  flow]       │
│ ┌──────────┐ │      │              │     │ Date of birth│    │              │
│ │ Me + my  │ │      │              │     │ [Mon][D][Yr] │    │ ☐ I agree +  │
│ │ kids     │ │      │              │     │              │    │   e-sign     │
│ └──────────┘ │      │              │     │ Email        │    │              │
│ ┌──────────┐ │      │              │     │ [_________]  │    │ [   Sign   ] │
│ │ A child  │ │      │              │     │ Phone (opt)  │    │              │
│ │ under 18 │ │      │              │     │ [_________]  │    │              │
│ └──────────┘ │      │              │     │              │    │              │
└──────────────┘      └──────────────┘     └──────────────┘    └──────────────┘
                       only on a kids path
```

**The document goes last** (WaiverSign's order). Short decisions first; the agreement is a review
step at the end.

**Label the choices with ages.** `Myself (18+)` / `Me + my kids` / `A child (under 18)`.

**Declare the number of kids before the form**, not with an `+ Add another` button. Picking "3"
generates three blocks and makes the ten-child cap visible.

**DOB is three selects, and the year range is constrained by step 1.** On `Myself (18+)` the year
list starts 18 years ago; on a child block it ends 18 years ago.

**Email required, phone optional.** Nothing verifies either.

**No forced scroll-to-bottom** on step 4. The text sits in page flow above the button.

**No drawn signature.** Typed name + legal-name checkbox + consent checkbox.

**One consent checkbox, not two.** One plain sentence; the long-form e-sign consent language sits
behind a "what does this mean?" link.

### A2 — The party step

Only rendered when the event has **more than one reservation**. A private charter has exactly one,
so BrewBoat never sees this screen.

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

- **Myself (18+)** — step 2 skipped; one block of details.
- **A child (under 18)** — guardian's details, then N child blocks: `Child's full name` +
  `Date of birth`. One signature covers all of them.
- **Me + my kids** — both, in that order.

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
| Event departed | *"This trip has already sailed."* + operator phone. No form. |
| Event cancelled | Same shape, cancellation wording. |
| Bad or expired link | *"We can't find that trip."* + operator phone. Never a stack trace, never a login. |
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
- In roster-off mode the unsigned two are a **number, never a guess at a name**.
- Duplicates may show grouped (*"Fred Kowalski ×2"*) so the booker can see who signed twice.
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
anyone aboard who never signed or was never ticked. It stops at the COI max. Its starting value is
open (`check-in-and-waivers.md` §14).

- **Every signed name is shown. Never a "…9 more."** The list scrolls inside its own region.
- **`SIGNED` is read-only and climbs on its own** as people scan at the rail (the screen polls).
- **Alphabetical by the name as typed.** A just-signed row lands in place with a brief highlight.
- **Minors are their own row**: `Kyle Smith (12) · w/ Robert`, tapped like anyone else.
- **Rows are ≥50px** with the whole row as the target.

### C2 — The QR sheet

`QR` opens a half-sheet, not a new page. Nothing else on it.

```
        [ ███ QR ███ ]

     Scan to sign — BrewBoat 3:00
              [ Done ]
```

Full screen brightness while open, restore on close. The guest scans with their own phone and signs
there. Behind the sheet, `SIGNED` climbs and their name appears in the list, unticked.

### C3 — States

| State | Screen |
|---|---|
| List empty | List replaced by *"Everyone's aboard"* and a check. |
| Nobody signed yet | Empty list, and the QR button is the biggest thing on the screen. |
| Some never show | Rows just stay. The mate departs with them unticked; they are no-shows or duplicates. |
| Checked in reaches the COI max | Remaining rows go inert; the header reads *"Full · 16 of 16."* No warning text. Unticking frees a spot. The stepper also stops at the max. |
| A tap fails (no connection) | The row shows it didn't save, with a retry. A tap never silently vanishes. |
| Already departed | §C4. |

### C4 — Confirm and depart

One tap, and it is the only heavy action. No confirmation dialog — the button already says the
number.

```
  ✓ 16 aboard · counted 2:58 PM by Mike R.

  [ Undo ]   (available until the trip ends)
```

Undo, not edit. A count is an attestation about a moment; correcting it is a new attestation, and
the old one stays in the record. After the event's end time the screen is read-only.

---

## D. Operator views

Thin.

- **Per-event** — count, signed coverage, who counted and when, exceptions. Reached from the event.
- **Day / week rollup** — counts by departure, and the no-show delta (`pax_counted` < booked).
- **Templates** — post new agreement text, which creates a new immutable version. No edit button.
- **Settings** — reminder frequency, age of majority, roster mode.

Export is a date range → CSV, three tabs, per `check-in-and-waivers.md` §10.

---

## E. Deliberately not built

- **Offline mode.** A future idea (`check-in-and-waivers.md` §11).
- **Wallet passes.** Real work, zero effect on whether the boat knows who's aboard.
- **A crew-facing search box.** Sixteen names scroll in one region. Search is for operators with 200.
- **Per-guest photos.** Solves nothing and turns the phone into a camera at the worst moment.
- **A staff "add guest by hand" form.** If crew are typing guest names, the QR flow failed.
- **Any modal that can block departure.** See `check-in-and-waivers.md` §8.
