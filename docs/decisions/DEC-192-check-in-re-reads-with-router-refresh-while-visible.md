---
schema: 1
id: DEC-192
title: "Check-in re-reads with router.refresh() while visible — the first poller"
topic: "UI, brand & frontend patterns"
status: "active"
date: "2026-10-02"
ruling: "The check-in page re-reads with router.refresh() every CHECKIN_REFRESH_SECONDS (default 20) while visible, once on becoming visible, and skips a beat while a tick is saving or a read is out. No read endpoint of its own."
claims:
  - kind: "file"
    target: "app/(crew)/crew/shift/[shiftId]/check-in/[eventId]/check-in-list.tsx"
    note: "the interval, the visibility pause, the guards"
revisit_if: "The dock test shows the page render, not the interval, is the load"
---

## DEC-192: Check-in re-reads with router.refresh() while visible

New signers appear without a reload (check-in-surfaces.md §C1). A refresh re-reads everything that
depends on them in one pass: the signed count, the list, the QR button's size when nobody has signed, a
count confirmed on another phone.

Next runs refreshes and server actions one at a time (next 16.2.7, `app-router-instance.js`
`dispatchAction`), so a re-read never lands after a tick it started before. A parallel fetch
would, and a saved tick would bounce back for an interval. The cost runs the other way: a tap made
during a refresh waits for it, hidden by the optimistic row.

A route handler saves about three queries a poll, not the call: it must still check the crew
member is on the shift before returning names. Hidden pages send nothing, so no backoff.

The interval is set after a dock test (operator, 2026-10-02: four boats, four or five phones
each). Not DEC-042's monitoring surface, whose no-polling stands. No sockets or server-pushed streams (DEC-047).
