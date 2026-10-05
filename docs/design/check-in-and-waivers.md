# Check-In & Waivers — Xola Replacement

Status: draft v0.9 · Thirteenth design artifact. Working name: **Muster**. Worked example: BrewBoat.
Screens live in the sibling `check-in-surfaces.md`. Patterns copied from shipping products are sourced
in `waiver-checkin-market-scan.md` (written in the design chat; not in this repo). The captain's log
and sea-time work are **separate, not yet designed**; where this doc mentions them it is naming a
future reader of a field, not a built dependency.

> **v0.9 changes — 2026-10-02, operator, speccing 18.5.** **The passenger count starts at the number
> signed** (§7, §14 — closed). **Check in** sits in each departure's row on the shift card (§7).
>
> **v0.8 changes — 2026-10-01, operator, after using 18.4.** **Signing asks nothing before the form**
> (§6, §7): no *who are you signing for?*, no *how many kids?*; `+ Add a minor` adds a card at a
> time, up to ten.
>
> **v0.7 changes — 2026-09-29, operator, while building 18.2.** **A waiver version locks when it
> takes effect** (§6, §10): before then nobody can have signed it, so a scheduled version is edited
> in place, and a future day holds one version. **Roster mode is a future idea** (§6), not a setting.
>
> **v0.6 changes — 2026-09-27, operator review.** Reconciles the doc with the codebase and with the
> operator's answers. **The COI rule** (§4a): nothing Muster records or displays ever exceeds the
> boat's legal passenger limit. **Ticks and the count are independent** (§3, §7): the mate taps names
> *and* sets the passenger count; the count is asserted, never derived. **"+ Not on the list" is
> gone** — an unsigned walk-on is covered by the count and gets no row. **Every signing is its own
> row** (§6): a shared phone or email never blocks a second signer, and nothing is merged. **Offline
> is a future idea**, not this build (§11). **There is no coexistence** (§13): waivers go live when
> Xola goes dark. **Reminder frequency is an admin setting** (§5). **Links carry a token, not the
> event id** (§7). **The checkout checkbox is payment terms**, not a waiver, and is renamed in this
> work (§6). §12 is superseded by the phased plan.
>
> Earlier: v0.5 made the list the interaction; v0.4 put the document last, retired overage (§9) and
> settled PWA; v0.3 adopted five patterns from the market scan; v0.2 reframed for private charter.

---

## 1. The reframe: check-in is the feature, the waiver is a field on it

The waiver is not the product. **Knowing who is on the boat is the product.**

The captain's-log work (still being specced) reached the same place from the other direction:
46 CFR 185.504 requires a passenger count *communicated ashore before departure*, a post-trip voyage
log cannot satisfy it, and the fix is a pre-departure confirm tap. **This doc builds that tap**,
arriving through a different door — a competitor asking how he checks people in.

**The waiver's own legal value is mostly not exculpatory.** 46 U.S.C. § 30527 voids contractual
limitations on a passenger vessel owner's liability for negligence, and while its application to a
single-port round trip is unsettled (*Ehart v. Lahaina Divers*, 9th Cir. 2024, 2-1; no Sixth Circuit
authority), the honest planning assumption is that the release itself is fragile. What survives is
everything *around* it: evidence that a specific person was presented specific text and accepted it
at a recorded time. **That is a data-capture problem** — and it is the same capture the check-in
screen needs anyway.

So: build the **check-in surface**. Waiver status is a badge on it.

---

## 2. What the competitor actually said (correcting v0.1)

v0.1 cited Mike at Tiki as evidence that per-person identity is a product requirement. That
overstated it. His words, in full, after being shown 185.504:

> *"Interesting well I appreciate that. I guess still from a business owners standpoint I want to
> know exactly who is on my boat but it definitely complicates things."*

Three things in one sentence: he accepted that the regulation asks only for a count, he reclassified
the roster as a **business owner's preference**, and he named the trade-off himself, unprompted.
That is not a requirement, and it is not a thing to build a flow for before he is a customer.

The useful part of that exchange is a different line — *"because we do not do public cruises it
might be a little different for us."* **That** is the real axis (§3).

---

## 2a. Build vs buy — resolved, build

Checked against the two serious third-party options and the incumbent (`market-scan`):

- **Xola Waivers cannot be built on.** It is a feature of Xola, not a product sold separately, and
  its signing URL is keyed on `orderId` + `itemId` — Xola's own booking objects. Keeping it means
  keeping Xola bookings, which is the thing being replaced. **Copy its UX, which is free.**
- **WaiverSign is out.** No check-in feature at all — the vendor concedes check-in lives in their
  RESMARK booking product. No kiosk app, no documented prefill parameters, no integration with any
  booking system in this market.
- **Smartwaiver is the only real candidate**, and the case against it is one finding: **neither
  vendor computes "14 of 16 signed."** Coverage counting only exists where the *booking system*
  owns the expected headcount. Muster already owns the manifest. Buying Smartwaiver still leaves the
  coverage math, the check-in screen and the count to build, and adds webhook ingestion, `auto_tag`
  round-tripping and $19–199/month to get a signing form.
- **The orphan problem is documented, not hypothetical.** FareHarbor's integration notes warn that
  signers **must** use the link from the confirmation email "otherwise signed waivers will not be
  correctly associated with the customer's booking." Building in-app removes it rather than
  managing it.

**What would reverse this:** a retention or legal-hold obligation heavy enough that owning the
documents becomes the liability (§14), or a real need for kiosk hardware.

---

## 3. Private charter inverts the problem

BrewBoat sells **whole boats**. One reservation, one booker, sixteen people on the dock. A
public-ticketed operator sells sixteen bookings with sixteen purchaser names attached at checkout.

| | Private charter (BrewBoat) | Public ticketed (Tiki, most operators) |
|---|---|---|
| Reservations per event | 1 | many |
| Names known at booking | 1 (the booker) | ~1 per booking, free |
| Hard part | **Names** — 15 anonymous humans | **The +1s** people bring along |
| Easy part | The count | Names |
| Who enforces signing | **The booker** (§5) | The operator, at the dock |

The consequence is that **names have to come from somewhere other than the crew.** A mate typing
sixteen strangers into a tablet is a gangway bottleneck that gets abandoned on the first busy
Saturday. Signing supplies the names; the crew never author them.

### What the mate actually does: work the list down, and state the count

> **Operator correction (2026-09-27).** An earlier draft had the mate reconcile two numbers with a
> read-only roster. Rejected: reconciling two numbers tells him a gap of two exists but not which
> two. The list *is* the job.

The scene this is designed for: **everyone is on the dock at once, standing there ready to get on.**
The check-in list has to be fast in that crowd.

Every signed guest is a row. **The mate taps a name as that person boards, and the row leaves the
list.** The list shrinks; when it is empty, everyone who signed is aboard. One tap per person.

**Separately, the mate sets the passenger count** (§4, §7). The two are independent on purpose:

- **Ticks answer "who."** They name the holdouts — two rows left means two specific people.
- **The count answers "how many."** It is the 185.504 attestation, and it includes people the list
  cannot: someone who never signed, a late friend who walked straight on. **An unsigned person has
  no row** — they are in the count and nowhere else.
- **Empty is a finish line** for the list; the count is confirmed once, before lines off.

Signed-but-absent people (Fred dropped out, Steve signed in his place) simply stay unticked. A
leftover row is a no-show, or a duplicate the rule in §6 could not tell, and it costs nothing.
Someone who signed twice in the same name and date of birth is one row (18.6).

### Signing at the dock does not tick you

Scanning the dock QR opens the signing page **on the guest's phone**. When they finish, their name
appears in the mate's list, unticked; the mate ticks it as they step aboard, like anyone else. The
three facts in §4 stay independent in the model *and* in the interaction.

---

## 4. Three facts, not one

Independent in the data model, different times, different assertors:

| Fact | When | Who asserts it | Meaning |
|---|---|---|---|
| **Signed** | Any time before departure — possibly a year early | The guest | This human accepted the release text. |
| **Checked in** | At the dock | Crew (a tick) | This named human boarded. |
| **Counted** | Once, before lines off | Captain / mate | N souls aboard. The 185.504 artifact. |

A guest can be signed and absent. A guest can be aboard and unsigned (§8 — the boat still leaves).
**The count is asserted, never derived** from ticks or signatures — it is an attestation about the
moment of departure, and it covers people the list does not.

## 4a. The COI rule

**Nothing Muster records or displays ever exceeds the boat's legal passenger limit**
(`vessels.coi_max_pax`). If a captain takes more aboard than the COI allows, that is not written
down anywhere by this software.

- The **count** cannot be set above the COI max. The stepper stops there.
- **Ticks** cannot exceed it either — a tick is a record that a named person boarded. At the max,
  the remaining rows go inert and the list header reads *"Full · 16 of 16."* Unticking frees a spot.
- **No warning names the limit.** The screen never shows or stores an over-limit fact; it simply
  does not go higher.

In practice the mate never ticks past the COI and never sees this. It exists for the "should never"
case, which is where a rule has to hold without depending on someone at a crowded gangway.

---

## 5. The booker is the enforcement mechanism

The highest-leverage move in the design, and it costs one link and one nudge.

The booker gets a page showing **`14 of 16 signed`**, with names, and **reminders at a frequency the
admin sets** (Xola's published cadence is 7, 3 and 1 day out — a reasonable default, not a
decision). She has lead time, a group text, and social authority over Fred that no mate standing at
a gangway has. Anything unresolved at the dock is then a gap of one or two, not fourteen.

**Reminders stop once everyone has signed.** A nudge that keeps arriving after the party is done is
how the booker learns to ignore Muster's messages, including the one that matters.

**Built in 18.7** (`src/checkin/reminders.ts`, run from the cron tick):

- **A reminder day is the boat's calendar day N days before the trip**, for each N in the admin's
  reminder days. A day the tick never reached is not made up later.
- **Only inside the civil send window** (`withinCivilWindow`, `src/config/tenant.ts`) — the hours
  the staffing engine already keeps for its own asks — so a reminder goes out when the window opens
  and a retry never lands at night. Not gated by the engine pause: that stops asks to crew.
- **Never twice for one window** (booking, trip date, day count). `waiver_reminders` is claimed
  before the send and given back when nobody was told, so a later tick that day tries again.
- **Everyone has signed** is the party page's count: a guarded minor is covered, someone who signed
  twice counts once.
- **A text every time there is a phone, an email when there is an address.** The message carries
  the count and the booking's party page (`/b/<code>/party`) — it asks the booker to look, never
  to forward: that link opens the booking. The group's link is on the page, behind **Share the link**.
- **Nothing while no waiver is in effect.** Posting the first waiver turns reminders on; an empty
  reminder-days list turns them off.
- The booking's history shows each reminder sent, and a reminder that missed a channel.

For public-ticketed operators the booker role is thinner (one or two people per booking), but the
same page works — it is per reservation either way.

---

## 6. Data model

**Built in 18.1.** The DDL is `db/migrations/20260929183642_check_in_and_waivers.sql`, and its
header carries the reasons; the types are `src/checkin/entities.ts`. The schema was reviewed item by
item with the operator (2026-09-29) and differs from the earlier draft in five ways:

- **The count is three columns on `events`, holding the current value only** — no history, editable
  at any time. Written only by `setDepartureCount`; `saveEvent` never touches it.
- **`waiver_templates` has no `retired_at`.** The current version is the latest `effective_from`
  that is not in the future, so posting new text is an insert and nothing else. It gains
  **`posted_at`** and **`posted_by`** (→ `admins`).
- **`signature_meta` is two plain columns**, `signed_ip` and `signed_user_agent`.
- **Every reference is a real foreign key**, `on delete restrict` (DEC-131), including
  `checked_in_by` and `counted_by` → `crew_members`.
- **Business rules stay in code** — an adult's email, the ten-kid cap, `is_minor`, the COI limit.

### `waiver_templates` — versioned, locked once in effect

A version **locks the moment it takes effect**: from then on someone may have signed it, so it is
never updated, and new words for a version in force are a new row. A guest stores the template id,
so five years later the exact words that person accepted can be produced — the only thing a signed
record has to do.

**Until it takes effect, a version can be edited in place** (operator, 2026-09-29): nobody can have
signed it yet. The operator picks a date, never a time. Dated today, a version takes effect the
moment it is posted, so a typo fix replaces the morning's version at once. Dated later, it takes
effect at midnight at the start of that day, boat time. A past date is refused. Because every future
version is midnight, **a future day holds one version**; a second for the same day is refused in
favour of editing the first, so two versions never take effect at the same instant. Same snapshot posture as `Event.price` and `reservations.extras_cents`. The body may be markdown;
whether it renders formatted is the signing page's call.

### `guests` — one row per signing, per event

Not `guest_contacts` (migration 0020), which records that crew texted a booking's contact — only the
names are close.

**Grain is per-event** — the manifest is per-event, not per-shift, because the Saturday 1/3/5 is
three boats' worth of different people. Walk-ups have no reservation, which is why `event_id` is the
NOT NULL one.

**Every signing is its own row, and nothing is ever merged or replaced.** Phone and email are *not*
identity: couples share an email, a family passes one phone down the line at the dock, people sign a
year early and change numbers before the trip. Blocking or replacing on a matching phone or email
would silently delete a real person's signature — the one thing the record exists to prove. Store
phone as E.164 and email lowercased.

**An obvious duplicate counts once** (operator, 2026-10-02, 18.6 — someone signing twice "happens all
the time"). It is **the same name, case and spacing ignored, and the same date of birth, within one
booking**; walk-ups match only walk-ups. Not a shared contact — couples share an email, and grouping
on it would hide a real person. Not the name alone — Sr. and Jr. sail together. Every surface shows
it once, *"Fred Kowalski ×2"*, and counts it once: the party page, the success screen, the mate's
`SIGNED`, and so the reminders' stop. The rows stay separate — this is how they are counted and
shown, never a merge. If the mate checks in both, it was two people, and both count. The rule is
`src/checkin/duplicates.ts`.

**Minors do not sign.** One adult signing session produces N rows: the adult with a signature, the
kids with `guardian_guest_id` pointing at them and null `signed_at`. Coverage math treats a guarded
minor as covered — a model requiring a signature per row reports a family of four as 25% done and
nags a nine-year-old.

**`is_minor` is derived from `dob` against a configurable age of majority, then frozen on the row**
(Smartwaiver's model). Derived, because asking a guardian to self-classify invites the wrong answer;
frozen, because the row is a record of a past departure and must not reclassify when the kid has a
birthday. The age of majority is a setting. Cap one signing session at one adult plus ten minors.

**DOB is three selects, and its range is constrained by the card it is on.** The signer's year list
starts 18 years ago; on a minor's card it ends 18 years ago. `is_minor` is enforced at the input rather
than validated after it (WaiverSign's detail).

**Email required, phone optional.** All three products require email and none requires phone, and
BrewBoat's own data agrees: DEC-017 found **email inline on 100% of reservations** against an
all-time phone fill of 97/497. Phone is the `customers` identity key (`phone_e164`, unique —
`db/migrations/20260722143000_customers.sql`), so capture it where offered, but never gate a signature
on it. **Nothing verifies either** — no confirm-your-email step.

**No `waivers` table.** The signature is four columns on the guest.

### A guest row exists only once someone signs

An unsigned person is in the count and has no row. Creating rows in advance from the booker's list,
so crew see who is expected before anyone signs ("roster mode"), is **a future idea**
(`docs/FUTURE_IDEAS.md`, 2026-09-29), not a setting (operator, 2026-09-29).

### The departure count

`events.pax_counted`, `counted_at`, `counted_by`: one number per departure, **the current value
only**, and the mate can change it at any time (operator, 2026-09-29 — the regulation asks for the
count, not a history of it). Never above the boat's COI limit (§4a); the domain enforces that. The
captain's log, when it is designed, reads this field rather than re-asking the mate.

**Nothing else that writes `events` may wipe it.** `saveEvent`'s upsert names its columns and leaves
these three alone; a contract test pins it.

### The checkout checkbox is not this module's

Today's checkout checkbox is agreement to the purchase terms, not a waiver. Issue #1112 (lane B)
owns it, including retiring its "waiver" naming. The booker signs the real waiver like every other
guest.

---

## 7. The surfaces

Screens are specified in `check-in-surfaces.md`. The mocks describe how the screens **function**;
they are built in Muster's existing look and feel.

### Signing — three doors, one page

One page, reached three ways. **Every link carries an unguessable token for the trip, never the raw
`event_id`**: the page lists booker surnames on a multi-reservation event, so a guessable link would
let anyone enumerate departures, read names and add junk signatures. The page is also rate-limited.
The token is an 8-character code, `/w/<code>`, one per departure, stored as it is and never revoked
(DEC-190); the limit is per client address (DEC-189).

1. **After checkout.** The confirmation (and the booker's manage page, `/b/[code]`) offers "sign the
   waiver," and after signing, the link for the rest of the party. The checkout checkbox stays
   payment terms only (§6).
2. **Shared link.** After signing, the page offers **"share with your party"**, which copies a URL
   to the clipboard for a text or group chat — not "forward this confirmation email."
3. **Dock QR.** Printed at the gangway, or on the mate's phone. Opens the signing page **on the
   guest's phone**; nothing happens on the mate's screen except the new name appearing in the list.

For a private charter there is exactly one reservation on the event, so the "who are you here
with?" step disappears. For a multi-reservation event it shows a short list by booker surname plus
"I'm a walk-up." Crew never type a guest's name.

### The order: the document goes LAST

| | Order |
|---|---|
| Xola | document → who → fields → sign |
| Smartwaiver | document (with an inline *Initial* box mid-text) → who → confirm → fields → consent → agree |
| **WaiverSign** | **who → fields → review document → sign** |

**Follow WaiverSign, less its *who* step.** Opening with a wall of legal text on a 390px screen is
the worst first impression of a page a guest was handed twenty seconds ago at a gangway. Nothing is
asked before the form either (operator, 2026-10-01): almost every guest signs for themselves.

1. **Your details** — legal name + certify checkbox, DOB (three constrained selects), email; phone
   offered, not required.
2. **Minors, if any** — `+ Add a minor` adds a card (name + DOB) at a time, up to ten.
3. **Review the agreement** — the full text in page flow, no forced scroll-to-bottom.
4. **Sign** — one consent checkbox and the button.

**The signature is a typed name plus a consent checkbox — not a drawn squiggle.** E-SIGN (15 U.S.C.
§ 7001) cares that the signer took a deliberate act indicating intent, not that the act looked like
a pen. Keep the **"I certify that this is my full legal name"** checkbox beside the name.

**No verification round-trip.** Nobody in this market gates signing on a confirm-your-email click,
and at a dock it would be a disaster.

### Crew check-in — a list that empties, and a count

On the crew app, per event: a **Check in** button in each departure's row on the shift card. One
screen, one gesture per person.

```
    ‹  BrewBoat · Sat Jul 18 · 3:00 PM
    ────────────────────────────────────────
      6 CHECKED IN                16 SIGNED
    ────────────────────────────────────────
     STILL TO BOARD · 10

     ┌────────────────────────────────────┐
     │  Amy Nowak                       ○ │
     │  Carla Vance                     ○ │
     │  Dmitri Volkov                   ○ │
     │  Fred Kowalski                   ○ │
     │  Grace Kim                       ○ │      ← scrolls; never "…9 more"
     │  …                                 │
     └────────────────────────────────────┘

     ✓ Checked in · 6            tap to undo ⌄
    ────────────────────────────────────────
     PASSENGERS   [ – ]  16  [ + ]    [ QR ]
     [   Confirm 16 aboard and depart   ]
```

- **Tapping a name checks that person in.** The row leaves `STILL TO BOARD` and lands in the
  `Checked in` disclosure, where tapping again undoes it.
- **Every signed name is shown. There is never a "…9 more."** The list scrolls inside its own
  region; header and footer stay put.
- **The passenger count is set by the mate**, independent of the ticks, and covers unsigned
  walk-ons. It stops at the COI max (§4a). It starts at the number signed until a count is
  confirmed (§14).
- **Ordered alphabetically by the name as typed.** People walk up saying "I'm Fred."
- **New signers appear without a refresh.** The page re-reads itself while it is on screen, every
  20 seconds by default (`CHECKIN_REFRESH_SECONDS`, set from a dock test — DEC-192).
- **At the COI max** the remaining rows go inert and the header reads *"Full · 16 of 16."* No
  warning names the limit (§4a).
- **Empty list is a finish line** — *"Everyone's aboard."*
- **`QR`** opens a half-sheet the guest scans with their own phone.
- **Footer** stamps `counted_at` / `counted_by` / `pax_counted` — the 185.504 artifact, written,
  ashore, timestamped, before lines are off.

Minors ride with their guardian: `Kyle Smith (12) · w/ Robert` is its own row, tapped separately.

---

## 8. Never block departure

The boat leaves. A system that can prevent that is worse than no system.

> **Confirmed by the operator, 2026-09-26:** *"we run cruises with unsigned guests. Our policy is
> everyone signs, but nobody is locking the boat to the slip if one person didn't sign."* The policy
> is strict; the software is a recorder.

- The count can be confirmed with unsigned guests aboard and with signed guests unticked.
- **Exceptions surface after the fact** on `/admin/integrity` — named, linked, counted: a departure
  whose count is higher than its checked-in signed guests had people aboard unsigned. A new check
  there (the page holds only structural checks today), in the shape 13.5 (#638) uses on
  `/admin/payroll`: warns, never blocks.

If a hard gate is ever wanted it belongs on a **report**, not on the gangway — 13.6's precedent
(#645).

---

## 9. Overage — retired

v0.3 argued the dock count was also a billing artifact. **The operator does not bill overage
(2026-09-26).** The count is a compliance artifact and a no-show signal, nothing more. Section kept
so the decision is on the record and cross-references do not shift.

---

## 10. Operator surface

Thin, because most of the value is on the crew screen.

- Per-event: count, signed coverage, exceptions, who counted and when — the departure page (18.8,
  `src/checkin/departure.ts`).
- Per-day / per-week rollup of counts by departure, with the no-show delta (`pax_counted` vs
  `party_size`).
- **Template management:** post new text → a new version. A scheduled version can be edited until it
  takes effect; one in effect never can (§6).
- **Settings:** reminder frequency (§5), age of majority (§6).
- **CSV export** of a date range for insurance or a claim, in **three tabs, copying Xola's roster
  export**: *Summary* (capacity, booked, counted, waivers signed), *Roster* (guest · signed at ·
  template version · checked in), *Waivers* (name · email). Range pushed into SQL, not filtered in
  JS; append-only with no reaper, so this is the table that grows.

**The rollup and the CSV export are deferred (2026-10-05)** to the Reports idea in
`docs/FUTURE_IDEAS.md`: sales and accounting reports first, waiver data an add-on. Nobody has yet
asked for this data, so its columns are unknown; the two bullets above are a sketch, not a spec.

---

## 11. Dock connectivity

**Offline is a future idea, not part of this build.** The first version is online-only.

- **Guest signing is fine.** Their phone, their cellular, one page. If the connection drops mid-sign,
  keep the typed values and retry; never lose the input.
- **A crew tap that fails says so** and can be retried. A tap never silently vanishes.
- **PWA is already settled in the repo** (`components/ui/register-sw.tsx`, `app/manifest.ts`, the
  icons in `public/`). When offline is taken up, it is a service worker's ordinary job: queued
  intended-state mutations, and a count that syncs carrying its *original* timestamp.

---

## 12. Build order

Superseded by the phased plan (to follow). Phase 0 is a doc sweep: SPEC.md and the decisions that
still say crew don't need waivers, or that the checkout checkbox is a waiver.

---

## 13. No coexistence

**Waivers go live when Xola goes dark.** There is no period where Xola bookings and Muster waivers
run side by side, and waivers signed in Xola are not imported. The dock QR replaces the clipboard on
day one.

### Scope correction (logged deliberately)

The SPEC records that crew do **not** need waiver data (the §0.4 glossary's *Manifest* row, §2.2's
manifest source and acceptance criteria, §2.6's shift card) and defers a per-guest waiver roster
(§2.8.12), as does DEC-012. That was correct **for its purpose** — it answered "what
does the crew manifest need before crew can stop opening Xola."

It does not survive contact with check-in: the mate at the dock is the only person standing there.
Waiver coverage lands on the crew surface as a **check-in concern**. The SPEC is amended in the
Phase 0 doc sweep, with a decision record that names the amendment (DEC-110, the old waiver decision,
is retired and replaced by nothing today).

---

## 14. Deferred / open

- **Reminder default** — the admin sets frequency (§5); what it ships as.
- **Age of majority** — the setting's default value.
- **Retention — the policy, not the mechanism.** Mechanism settled: **redact, not move.** Once a
  season, on rows older than N: null `signature_meta`, `dob`, `email`, `phone`; keep `name`,
  `signed_at`, `waiver_template_id`, `event_id`. Still needed: **N**, and whether minors get a longer
  clock (their limitations period starts at majority). With Drew.
- **Insurance requirements.** Whether the carrier expects anything specific about capture or
  retention — with Drew, same conversation.
- **Offline** (§11) — future idea.

**Closed:** the passenger count's starting value (**the number signed**, 2026-10-02); overage (§9); unsigned-at-departure (§8); repeat-customer reuse (**sign every trip**);
PWA vs native (§11); email required, phone optional (§6); document last (§7); the COI rule (§4a);
ticks and count independent (§3); no merging on phone or email (§6); no coexistence (§13); the
checkout checkbox is payment terms (§6); build vs buy (§2a); waiver text (lifted from the existing
form).
