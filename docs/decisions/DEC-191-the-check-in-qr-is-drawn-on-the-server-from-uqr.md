---
schema: 1
id: DEC-191
title: "The check-in QR is drawn on the server from uqr"
topic: "Check-in & waivers"
status: "active"
date: "2026-10-02"
ruling: "The trip QR is an inline SVG drawn on the server from uqr's module grid, one path, black on white. No QR image service; no hand-rolled encoder."
claims:
  - kind: "file"
    target: "components/crew/qr-path.ts"
    note: "the only importer of uqr"
revisit_if: "A code drawn this way fails to scan on a guest's phone at the dock, or uqr stops building"
---

## DEC-191: The check-in QR is drawn on the server from uqr

The repo hand-rolls where it can: the calendar feed (DEC-098), the xlsx ZIP read (DEC-037), email
over fetch (DEC-081). Each was an afternoon. A QR encoder is Reed–Solomon, eight masks and format
codes, and a subtly wrong one scans on some phones and not others — found at the gangway.

uqr: MIT, no dependencies, a port of Nayuki's reference encoder. `encode()` returns the module
grid; `qr-path.ts` joins each row's dark run into one rectangle of one `<path>`, with no
`dangerouslySetInnerHTML`. Operator approved the dependency and installed it (2026-10-02).

On the server: the sheet is in the page when it loads, so it still shows after the signal drops,
and uqr never ships to the browser (only server components import it).

*Rejected:* `qrcode` (yargs and pngjs at runtime, no types); a QR image service (every departure's
link, DEC-190, sent to a third party, and one more fetch on dock signal); vendoring the reference
file (a thousand lines of someone else's code under the lint gate).
