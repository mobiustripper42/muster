#!/usr/bin/env node
/**
 * A LIVE AUDIT'S CITATIONS ROT SILENTLY, AND PROSE DID NOT STOP IT.
 *
 * `docs/audit/2026-08-29-spec-2.8-conformance.md` cites `docs/SPEC.md` and the code by line
 * number, several dozen times. Its own "Resuming this" section tells the next reader to check
 * each citation against the tree and correct what drifted. That rule was written on 2026-08-31
 * and broken the same day: PR #869 (DEC-164) added a net 23 lines to §2.8, the audit branch
 * merged after it without conflict, and thirteen citations silently started pointing at the
 * wrong sentences. Nothing failed. The document went on reading as verified.
 *
 * `check-docs.mjs` cannot catch this and is not being asked to. It excludes audit directories
 * on the reasoning that an audit is a frozen record — true of `docs/audit/2026-07-25/` and of
 * the cutover ledger, false of this one, which has 18 criteria still to verdict. And even
 * included, it resolves paths and § anchors, never "does line 1770 still say what you claimed".
 *
 * THE SHAPE OF THE FIX: the quote is the citation and the line number is derived.
 *
 * Every entry below is a line number plus a substring that must be ON that line. Both halves
 * are already in the document — it quotes what it cites, in prose, everywhere. Encoding the
 * pair is what turns a drifted number from an invisible lie into a mechanical correction:
 *
 *   MOVED    the quote is in the file at a different line. The document is stale; the finding
 *            is intact. Write the new number.
 *   GONE     the quote is not in the file at all. This is the case worth stopping for — the
 *            spec moved under a finding, and the finding needs re-reading rather than
 *            renumbering. Three of these were DEC-161 rewriting §2.8.3 and §2.8.4a out from
 *            under flaw #1, which is a real change of meaning, not drift.
 *   AMBIGUOUS  the quote appears more than once. Make it longer, not the number righter.
 *
 * COVERAGE IS REPORTED, NEVER ASSUMED. A gate covering half a document and printing green is
 * the same failure as the prose rule, wearing a checkmark. The manifest is deliberately smaller
 * than the document's full citation count; the summary prints both numbers so the gap is a
 * fact on screen rather than something a reader has to suspect. The document-side number counts
 * *occurrences*, not distinct locations — `docs/SPEC.md:2046` and `claim.ts:203` are each cited
 * twice — so it overstates slightly. Left over-inclusive on purpose: a coverage number that
 * flatters itself is worse than one that nags.
 *
 * DELIBERATELY NOT IN `npm run verify`. It was, for about an hour, and that was a trap: the
 * pinned lines span roughly 40% of a 2,800-line document that every booking task edits, so any
 * unrelated change above §2.10 would shift every citation below it and hard-fail the gate for an
 * author who has never heard of this file. The failure is trivial to fix and impossible to
 * understand, which is the worst combination a build error can have. It runs when someone is
 * working the audit — `npm run check:audit`, named in the document's own "Resuming this".
 */
import { readFileSync, existsSync } from 'node:fs'

const AUDIT = 'docs/audit/2026-08-29-spec-2.8-conformance.md'

/**
 * `line` is where the audit says the text is. `quote` must appear on that line.
 *
 * Keep quotes long enough to be unique and short enough to survive reflowing — the documents
 * here are hard-wrapped at ~100 columns, so a quote spanning a line break can never match. That
 * is a real constraint on what can be encoded, not a bug: `§2.8.3`'s "a fleet with more than one
 * offering" is split across `:1540-1541` and is anchored on its first half.
 */
const CITATIONS = [
  // ── docs/SPEC.md §2.8, re-baselined 2026-08-31 after PR #869 (DEC-164) shifted §2.8 by +23 ──
  ['docs/SPEC.md', 1484, 'reservation payment path is being built from scratch'],
  ['docs/SPEC.md', 1488, '**2.8.1 One record holds the boat.**'],
  ['docs/SPEC.md', 1501, '`cancelled` | Cancelled after the fact'],
  ['docs/SPEC.md', 1503, 'Nothing else claims a slot.'],
  ['docs/SPEC.md', 1509, '**2.8.2 A pending reservation names a slot, not an Event.**'],
  ['docs/SPEC.md', 1512, 'materializes nothing'],
  ['docs/SPEC.md', 1514, 'the contract, not a convenience'],
  ['docs/SPEC.md', 1517, 'Null until confirm'],
  ['docs/SPEC.md', 1519, "**2.8.3 What a reservation occupies is the hull for the trip's hold minutes.**"],
  ['docs/SPEC.md', 1521, 'whose time window overlaps prevents the sale'],
  ['docs/SPEC.md', 1524, 'moment.'],
  ['docs/SPEC.md', 1537, 'off-grid times are refused'],
  ['docs/SPEC.md', 1540, 'measured by its own hold minutes, not the asking offering'],
  ['docs/SPEC.md', 1600, '**2.8.4a What the customer is charged.**'],
  ['docs/SPEC.md', 1638, '**Also frozen: both durations.**'],
  ['docs/SPEC.md', 1724, '**2.8.5 Payment identity lives on our side.**'],
  ['docs/SPEC.md', 1742, 'matched by possession, never by claimed identity'],
  ['docs/SPEC.md', 1743, 'httpOnly cookie'],
  ['docs/SPEC.md', 1821, '**2.8.8 Expiry is a clock, not a job.**'],
  ['docs/SPEC.md', 1829, 'every reader tests'],
  ['docs/SPEC.md', 2014, 'No separate hold object'],
  ['docs/SPEC.md', 2046, 'off-grid, outside the offering'],
  ['docs/SPEC.md', 2057, "eventId` is null"],
  ['docs/SPEC.md', 2090, 'booking-recovery lookup returns nothing'],
  ['docs/SPEC.md', 2337, '## 2.10 Reservations — what the operator runs'],
  // The END of §2.10, pinned on the heading that follows it. An earlier draft pinned line 2545
  // with an empty quote as a "bound anchor" — which only proved the file still had 2545 lines and
  // would have stayed green if §2.10 shrank by five hundred. It was also simply wrong: 2545 is
  // inside §3, and the audit's range citation overshot by six lines because of it. A boundary is
  // a claim about where a section stops, so it has to be pinned on something that says so.
  ['docs/SPEC.md', 2540, '# 3. Cross-cutting'],
  ['docs/SPEC.md', 1908, 'crew manifest reads reservations directly'],
  ['docs/SPEC.md', 1910, 'why the null is a contract'],
  ['docs/SPEC.md', 347, '**Booking horizon**'],
  ['docs/SPEC.md', 324, '**A lead-time cutoff.**'],

  // ── Criterion 6's evidence (§Criterion 6) ──
  ['src/domain/entities.ts', 615, 'ReservationStatus = "booked" | "cancelled"'],
  ['src/domain/entities.ts', 619, 'eventId: EventId;'],
  ['src/reservations/write-booking.ts', 87, 'export async function writeSlotBooking('],
  ['src/reservations/booking-webhook.ts', 361, 'await writeSlotBooking('],
  ['src/reservations/create-departure-payment-intent.ts', 170, 'The SLOT — no eventId'],
  ['src/reservations/create-departure-checkout.ts', 149, 'The SLOT — no eventId'],
  ['app/(public)/book/checkout/actions.ts', 166, 'createDeparturePaymentIntent('],
  ['src/reservations/create-departure-payment-intent.test.ts', 94, 'metadata.eventId).toBeUndefined()'],
  ['src/reservations/create-departure-payment-intent.test.ts', 256, 'not.toBeNull(); // materialized'],
  ['src/reservations/create-departure-payment-intent.test.ts', 336, 'listAllReservations()).toHaveLength(0)'],
  ['src/reservations/create-departure-payment-intent.test.ts', 347, 'listAllReservations()).toHaveLength(0)'],
  ['src/reservations/create-departure-checkout.test.ts', 72, 'carries the SLOT (no eventId)'],
  ['src/reservations/create-departure-checkout.test.ts', 83, 'metadata.eventId).toBeUndefined()'],
  ['src/reservations/create-departure-checkout.test.ts', 123, 'not.toBeNull(); // materialized'],
  ['src/reservations/create-departure-checkout.test.ts', 201, 'getEvent(eventIdForSlot(SMALL'],
  ['src/reservations/create-departure-checkout.test.ts', 202, 'getEvent(eventIdForSlot(BIG'],
  ['src/import/import-reservations.test.ts', 57, 'getEvent(EVENT_ID)).toBeNull()'],
  ['src/adapters/repository-contract.ts', 844, 'getEvent(SLOT_ID)).toBeNull()'],

  // ── Criterion 7's evidence (§Criterion 7) ──
  ['docs/SPEC.md', 2058, 'Abandoning checkout leaves no `Event`'],
  ['src/reservations/create-departure-payment-intent.ts', 141, 'getPaymentConfig()'],
  ['src/reservations/create-departure-payment-intent.ts', 166, 'receiptEmail: req.email'],
  ['src/reservations/write-booking.ts', 122, 'await resolveCustomerId(repo, req, now)'],
  ['src/import/import-reservations.ts', 256, 'resolveCustomerId('],
  ['src/reservations/ensure-booking-code.ts', 49, 'export async function ensureBookingCode('],
  ['src/reservations/recover-booking-link.ts', 98, 'await ensureBookingCode('],
  ['app/lib/booking-confirmation.ts', 58, 'await ensureBookingCode('],
  ['app/lib/booking-confirmation.ts', 117, 'await ensureBookingCode('],
  ['src/reservations/booking-webhook.ts', 68, 'alertPaidButUnbooked:'],
  ['src/reservations/booking-webhook.ts', 76, 'notifyCustomerSoldOut:'],
  ['src/reservations/booking-webhook.ts', 84, 'sendConfirmation:'],
  // The sender call site OUTSIDE `booking-webhook.ts`. §Criterion 7 originally claimed every one
  // was inside that file — false, and exactly the overstated-absence mistake this document has
  // made before. Pinned so the correction cannot quietly rot back.
  ['src/reservations/confirm-booking.ts', 48, 'await deps.alertPaidButUnbooked('],
  ['docs/SPEC.md', 2082, "hold minutes, trip time or schedule"],
  ['src/customers/resolve.test.ts', 91, 'listCustomers()).toHaveLength(0)'],
  ['src/customers/resolve.test.ts', 201, 'listCustomers()).toHaveLength(0)'],
  ['src/reservations/availability.test.ts', 587, 'an EXPIRED hold contributes nothing'],
  ['src/reservations/claim.test.ts', 357, 'an EXPIRED overlapping hold does not occupy anything'],

  // ── Criterion 8's evidence (§Criterion 8) ──
  ['docs/SPEC.md', 2060, 'The trip comes free the instant the window passes'],
  ['src/reservations/availability.ts', 333, 'h.expiresAt > input.asOf'],
  ['src/reservations/claim.ts', 215, 'h.expiresAt <= at0'],
  ['src/reservations/claim.ts', 266, 'h.expiresAt > at0'],
  ['src/adapters/postgres-repository.ts', 1727, 'from checkout_holds where expires_at > $1'],
  ['src/adapters/in-memory-repository.ts', 763, 'h.expiresAt > asOf'],
  ['src/adapters/repository-contract.ts', 1102, 'listLiveCheckoutHolds("2026-07-01T12:15:00.000Z")).toHaveLength(0)'],
  ['src/adapters/repository-contract.ts', 1103, 'listLiveCheckoutHolds("2026-07-01T12:14:59.999Z")).toHaveLength(1)'],
  ['src/adapters/repository-contract.ts', 1106, 'sweeps EVERY expired hold, not just its own slot'],
  ['src/adapters/repository-contract.ts', 1128, 'never touches a LIVE hold on another slot'],
  ['src/adapters/postgres-repository.test.ts', 84, 'const dbUp = await canConnect(TEST_URL)'],
  ['src/adapters/postgres-repository.test.ts', 94, 'runRepositoryContract("postgres"'],
  ['src/adapters/in-memory-repository.test.ts', 9, 'runRepositoryContract("in-memory"'],

  // ── Criterion 2 / 5 evidence, spot-checked while re-baselining ──
  ['src/reservations/availability.ts', 172, 'return asId<"EventId">(`slot_${slotIdentity('],
  ['app/(public)/book/page.tsx', 91, 'repo.listLiveCheckoutHolds(asOf)'],
  ['src/reservations/claim.ts', 312, 'await repo.acquireCheckoutHold(hold)'],
  ['src/adapters/in-memory-repository.ts', 462, 'async cancelEventIfUnclaimed('],
]

const cache = new Map()
const lines = (f) => {
  if (!cache.has(f)) cache.set(f, existsSync(f) ? readFileSync(f, 'utf8').split('\n') : null)
  return cache.get(f)
}

const problems = []
for (const [file, line, quote] of CITATIONS) {
  const L = lines(file)
  if (L === null) { problems.push(['MISSING FILE', `${file}:${line}`, file]); continue }
  if ((L[line - 1] ?? '').includes(quote)) continue

  const found = []
  L.forEach((l, i) => { if (l.includes(quote)) found.push(i + 1) })
  if (found.length === 1) problems.push(['MOVED', `${file}:${line} → :${found[0]}`, quote])
  else if (found.length === 0) problems.push(['GONE', `${file}:${line}`, quote])
  else problems.push(['AMBIGUOUS', `${file}:${line} — ${found.length} hits at ${found.join(', ')}`, quote])
}

/**
 * Every `path:NNN` and bare `` `:NNN` `` the audit document contains. Compared against the
 * manifest so the summary can state what fraction is actually pinned. Deliberately crude — it
 * over-counts ranges as one and misses nothing that looks like a citation, which is the right
 * direction to be wrong in for a coverage number.
 */
const auditText = existsSync(AUDIT) ? readFileSync(AUDIT, 'utf8') : ''
const cited = (auditText.match(/[\w./()[\]-]+\.\w+:\d+|`:\d+(?:-\d+)?`/g) ?? []).length

for (const [kind, where, quote] of problems) {
  console.error(`${kind.padEnd(12)} ${where}\n${' '.repeat(13)}${JSON.stringify(quote)}`)
}

const pinned = CITATIONS.length
if (problems.length) {
  console.error(`\n✗ audit citations — ${problems.length} of ${pinned} pinned citations do not resolve.`)
  console.error(`  MOVED means write the new number. GONE means re-read the finding.`)
  process.exit(1)
}
console.log(
  `✓ audit citations — ${pinned} pinned and resolving in ${AUDIT}; ` +
  `~${cited} citations in the document, so ~${Math.max(0, cited - pinned)} are NOT pinned and drift silently`,
)
