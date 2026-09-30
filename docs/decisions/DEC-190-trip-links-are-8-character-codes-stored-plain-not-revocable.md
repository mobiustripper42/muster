---
schema: 1
id: DEC-190
title: "Trip links are 8-character codes, one per departure, stored plain, not revocable"
topic: "Check-in & waivers"
status: "active"
date: "2026-09-30"
ruling: "A departure's waiver link is /w/<code>: 8 characters of the booking-code alphabet, one per departure, made when first needed, stored as it is and never revoked."
claims:
  - kind: "file"
    target: "src/checkin/trip-link.ts"
    note: "mint, normalize, ensure, resolve, open"
  - kind: "file"
    target: "db/migrations/20260930204732_trip_links.sql"
    note: "one code per departure, one departure per code"
revisit_if: "A leaked link is abused — strangers signing a trip that is not theirs — and a replace-the-code action is needed"
---

## DEC-190: Trip links are 8-character codes, one per departure, stored plain, not revocable

The link is shared with the whole party and printed at the dock, so it is public within the trip.
It exists so strangers cannot find departures by trying event ids (the spec's §7). Operator,
2026-09-29: it should match the booking-code format, short, and it does not need revoking.

Eight characters, not the booking code's 14: a booking code opens one person's booking; a trip code opens a date, a
time and at most a booker's surname. 32^8 ≈ 1.1×10^12, so even with a thousand live trips a guesser
spread across many addresses needs about a billion tries per hit. The per-address limit (DEC-189)
is on top of that, not instead of it.

Stored plain, not hashed: hashing protects a stored secret from someone who can read the database, who can
already read the guest names the code guards. And the link has to be shown again on the manage
page, the dock code and the reminders; a hash would mean a new code each time, killing the one already in
the group chat.

Not revocable: cancelled and departed trips answer by state. Replacing a code is one row if a
leak is ever abused.
