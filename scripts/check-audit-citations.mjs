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
  ['docs/SPEC.md', 1485, 'reservation payment path is being built from scratch'],
  ['docs/SPEC.md', 1489, '**2.8.1 One record holds the boat.**'],
  ['docs/SPEC.md', 1501, '`cancelled` | Cancelled after the fact'],
  ['docs/SPEC.md', 1503, 'Nothing else claims a slot.'],
  ['docs/SPEC.md', 1514, '**2.8.2 A pending reservation names a slot, not an Event.**'],
  ['docs/SPEC.md', 1517, 'materializes nothing'],
  ['docs/SPEC.md', 1519, 'the contract, not a convenience'],
  ['docs/SPEC.md', 1522, 'Null until confirm'],
  ['docs/SPEC.md', 1524, "**2.8.3 What a reservation occupies is the hull for the trip's hold minutes.**"],
  ['docs/SPEC.md', 1526, 'whose time window overlaps prevents the sale'],
  ['docs/SPEC.md', 1529, 'moment.'],
  ['docs/SPEC.md', 1542, 'off-grid times are refused'],
  ['docs/SPEC.md', 1545, 'measured by its own hold minutes, not the asking offering'],
  ['docs/SPEC.md', 1605, '**2.8.4a What the customer is charged.**'],
  ['docs/SPEC.md', 1643, '**Also frozen: both durations.**'],
  ['docs/SPEC.md', 1729, '**2.8.5 Payment identity lives on our side.**'],
  ['docs/SPEC.md', 1747, 'matched by possession, never by claimed identity'],
  ['docs/SPEC.md', 1748, 'httpOnly cookie'],
  ['docs/SPEC.md', 1826, '**2.8.8 Expiry is a clock, not a job.**'],
  ['docs/SPEC.md', 1834, 'every reader tests'],
  ['docs/SPEC.md', 2022, 'No separate hold object'],
  // Lengthened 2026-09-03: "off-grid, outside the offering" also matches §2.8.3 at :1565, and the
  // checker reported AMBIGUOUS rather than picking one. The criterion's own leading words are unique.
  ['docs/SPEC.md', 2054, '- [ ] A trip that is off-grid, outside the offering'],
  ['docs/SPEC.md', 2065, "eventId` is null"],
  ['docs/SPEC.md', 2101, 'booking-recovery lookup returns nothing'],
  ['docs/SPEC.md', 2348, '## 2.10 Reservations — what the operator runs'],
  // The END of §2.10, pinned on the heading that follows it. An earlier draft pinned line 2545
  // with an empty quote as a "bound anchor" — which only proved the file still had 2545 lines and
  // would have stayed green if §2.10 shrank by five hundred. It was also simply wrong: 2545 is
  // inside §3, and the audit's range citation overshot by six lines because of it. A boundary is
  // a claim about where a section stops, so it has to be pinned on something that says so.
  ['docs/SPEC.md', 2565, '# 3. Cross-cutting'],
  ['docs/SPEC.md', 1912, 'crew manifest reads reservations directly'],
  ['docs/SPEC.md', 1914, 'why the null is a contract'],
  ['docs/SPEC.md', 347, '**Booking horizon**'],
  ['docs/SPEC.md', 324, '**A lead-time cutoff.**'],

  // ── Criterion 6's evidence (§Criterion 6) ──
  ['src/domain/entities.ts', 625, 'ReservationStatus = "pending" | "booked" | "cancelled"'],
  ['src/domain/entities.ts', 662, 'eventId: EventId | null;'],
  ['src/reservations/write-booking.ts', 96, 'export async function writeSlotBooking('],
  ['src/reservations/booking-webhook.ts', 382, 'await writeSlotBooking('],
  ['src/reservations/create-departure-payment-intent.ts', 228, 'The SLOT — no eventId'],
  ['src/reservations/create-departure-checkout.ts', 150, 'The SLOT — no eventId'],
  ['app/(public)/book/checkout/actions.ts', 173, 'createDeparturePaymentIntent('],
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
  ['src/adapters/repository-contract.ts', 878, 'getEvent(SLOT_ID)).toBeNull()'],

  // ── Criterion 7's evidence (§Criterion 7) ──
  ['docs/SPEC.md', 2066, 'Abandoning checkout leaves no `Event`'],
  ['src/reservations/create-departure-payment-intent.ts', 147, 'getPaymentConfig()'],
  ['src/reservations/create-departure-payment-intent.ts', 224, 'receiptEmail: req.email'],
  ['src/reservations/write-booking.ts', 133, 'await resolveCustomerId(repo, req, now)'],
  ['src/import/import-reservations.ts', 265, 'resolveCustomerId('],
  ['src/reservations/ensure-booking-code.ts', 49, 'export async function ensureBookingCode('],
  ['src/reservations/recover-booking-link.ts', 98, 'await ensureBookingCode('],
  ['app/lib/booking-confirmation.ts', 59, 'await ensureBookingCode('],
  ['app/lib/booking-confirmation.ts', 118, 'await ensureBookingCode('],
  ['src/reservations/booking-webhook.ts', 70, 'alertPaidButUnbooked:'],
  ['src/reservations/booking-webhook.ts', 78, 'notifyCustomerSoldOut:'],
  ['src/reservations/booking-webhook.ts', 86, 'sendConfirmation:'],
  // The sender call site OUTSIDE `booking-webhook.ts`. §Criterion 7 originally claimed every one
  // was inside that file — false, and exactly the overstated-absence mistake this document has
  // made before. Pinned so the correction cannot quietly rot back.
  ['src/reservations/confirm-booking.ts', 48, 'await deps.alertPaidButUnbooked('],
  ['docs/SPEC.md', 2090, "hold minutes, trip time or schedule"],
  ['src/customers/resolve.test.ts', 91, 'listCustomers()).toHaveLength(0)'],
  ['src/customers/resolve.test.ts', 201, 'listCustomers()).toHaveLength(0)'],
  ['src/reservations/availability.test.ts', 686, 'an EXPIRED hold contributes nothing'],
  ['src/reservations/claim.test.ts', 357, 'an EXPIRED overlapping hold does not occupy anything'],

  // ── Criterion 8's evidence (§Criterion 8) ──
  ['docs/SPEC.md', 2068, 'The trip comes free the instant the window passes'],
  ['src/reservations/availability.ts', 362, 'h.expiresAt > input.asOf'],
  ['src/reservations/claim.ts', 187, 'h.expiresAt <= at0'],
  ['src/reservations/claim.ts', 246, 'h.expiresAt > at0'],
  ['src/adapters/postgres-repository.ts', 1901, 'from checkout_holds where expires_at > $1'],
  ['src/adapters/in-memory-repository.ts', 812, 'h.expiresAt > asOf'],
  ['src/adapters/repository-contract.ts', 1329, 'listLiveCheckoutHolds("2026-07-01T12:15:00.000Z")).toHaveLength(0)'],
  ['src/adapters/repository-contract.ts', 1330, 'listLiveCheckoutHolds("2026-07-01T12:14:59.999Z")).toHaveLength(1)'],
  ['src/adapters/repository-contract.ts', 1333, 'sweeps EVERY expired hold, not just its own slot'],
  ['src/adapters/repository-contract.ts', 1355, 'never touches a LIVE hold on another slot'],
  ['src/adapters/postgres-repository.test.ts', 84, 'const dbUp = await canConnect(TEST_URL)'],
  ['src/adapters/postgres-repository.test.ts', 97, 'runRepositoryContract("postgres"'],
  ['src/adapters/in-memory-repository.test.ts', 9, 'runRepositoryContract("in-memory"'],

  // ── Criterion 9's evidence (§Criterion 9) ──
  ['docs/SPEC.md', 2069, 'An abandoned checkout is still on disk afterwards as a lapsed `pending` reservation'],
  ['docs/SPEC.md', 2071, 'is a query.'],
  ['src/domain/entities.ts', 843, 'guestCount: number;'],
  ['src/domain/entities.ts', 847, 'createdAt: string;'],
  ['src/adapters/postgres-repository.ts', 1854, "delete from checkout_holds where source='muster' and expires_at <= $1"],
  ['src/adapters/postgres-repository.ts', 1847, 'grew the table without bound'],
  ['src/adapters/in-memory-repository.ts', 788, 'h.expiresAt <= hold.createdAt'],
  ['src/reservations/create-departure-payment-intent.ts', 100, 'await acquireDepartureHold('],
  ['src/reservations/create-departure-payment-intent.ts', 211, 'await payments.createPaymentIntent('],
  ['db/migrations/0024_audit_events.sql', 1, 'crew audit log (#400, DEC-118)'],
  // §2.8.8's three mechanisms. Pinned individually because an earlier draft of §Criterion 9 read
  // the subsection's title — "Expiry is a clock, not a job" — and stopped, concluding §2.8 had no
  // answer to unbounded growth. It specifies two jobs, twenty lines below the title.
  ['docs/SPEC.md', 1834, 'A pending reservation stops occupying its boat the moment its window runs out'],
  // 14.1 (2026-09-04) removed the sweeper; these four pin the sentences that replaced it.
  ['docs/SPEC.md', 1838, '**There is no sweeper.**'],
  ['docs/SPEC.md', 1844, 'It never deletes a row it cannot prove was unpaid'],
  ['docs/SPEC.md', 1843, 'deletes old lapsed rows so the table does not'],
  ['docs/SPEC.md', 1850, 'The reaper\'s horizon is long, and this is load-bearing rather than tidy'],
  ['docs/SPEC.md', 1856, 'hulls tied up for people who were never going to buy'],
  ['docs/SPEC.md', 1828, "an operator's booking, `source`"],
  ['db/migrations/20260718142705_claim_hold_mutex.sql', 33, 'create table if not exists checkout_holds ('],

  // ── Criterion 10's evidence (§Criterion 10) ──
  ['docs/SPEC.md', 2072, 'A declined card retried on the same trip reuses the same reservation'],
  ['docs/SPEC.md', 1747, 'A retry is matched by possession, never by claimed identity'],
  ['docs/SPEC.md', 1749, 'It must never be the typed email or phone'],
  ['src/reservations/claim.ts', 85, 'export interface DepartureHoldRequest {'],
  ['src/reservations/claim.ts', 98, 'holderToken?: string | undefined;'],
  ['src/reservations/claim.ts', 237, 'Matched on POSSESSION of the holder token, never on the buyer'],
  ['src/reservations/claim.ts', 245, 'h.holderToken === holderToken'],
  ['src/reservations/claim.ts', 261, 'Returned with its ORIGINAL expiry, not a fresh one'],
  ['src/reservations/claim.ts', 264, 'return { held: mine };'],
  ['src/reservations/claim.test.ts', 508, 'expect("held" in first && "held" in second).toBe(true)'],
  ['src/reservations/claim.test.ts', 510, 'expect(second.held.expiresAt).toBe(first.held.expiresAt)'],
  ['src/reservations/holder-token.ts', 4, 'Why possession and not identity'],
  ['src/reservations/holder-token.ts', 27, 'return bytes(32).toString("base64url");'],
  ['src/reservations/holder-token.ts', 32, 'const HOLDER_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/'],
  ['app/(public)/book/checkout/actions.ts', 103, 'httpOnly: true,'],
  ['app/(public)/book/checkout/actions.ts', 107, 'sameSite: "lax",'],
  ['src/reservations/claim.test.ts', 484, 'returns the SAME hold on a retry instead of taking a second boat'],
  ['src/reservations/claim.test.ts', 497, 'does NOT extend the expiry — a retry cannot park a boat indefinitely'],
  ['src/reservations/claim.test.ts', 526, 'takes a bigger boat when the retry no longer FITS'],
  ['src/reservations/claim.test.ts', 585, 'two sessions with NO token never share a hold'],
  ['src/reservations/claim.test.ts', 600, 'an EXPIRED hold of the same buyer is not reused'],
  ['src/reservations/claim.test.ts', 611, 'does not reuse a hold from a different departure'],

  // ── Criterion 11's evidence (§Criterion 11) ──
  ['docs/SPEC.md', 2074, 'payment_intent.payment_failed'],
  ['src/adapters/stripe-payment.ts', 194, 'event.type === "checkout.session.completed"'],
  ['src/adapters/stripe-payment.ts', 209, 'event.type === "charge.refunded"'],
  ['src/adapters/stripe-payment.ts', 265, 'event.type === "payment_intent.succeeded"'],
  ['src/adapters/stripe-payment.ts', 277, 'return null;'],
  ['src/adapters/fake-payment.ts', 76, 'parseEvent'],
  ['src/reservations/booking-webhook.ts', 144, 'if (!event) return { handled: false };'],
  ['app/api/webhooks/stripe/route.ts', 21, 'Stripe dashboard nobody can read from the repo'],
  ['app/api/webhooks/stripe/route.ts', 46, 'return NextResponse.json({ received: true, ...result });'],
  ['src/reservations/booking-webhook.test.ts', 320, 'handled:false for a non-checkout event'],
  ['src/reservations/booking-webhook.test.ts', 84, 'getReservation(reservationIdFor("cs_test_1"))).toBeNull()'],

  // ── Criterion 12's evidence (§Criterion 12) ──
  ['docs/SPEC.md', 2075, 'superseded payment that succeeds late'],
  ['docs/SPEC.md', 1735, 'A reservation has many payment ids over its life, not one'],
  ['docs/SPEC.md', 1738, 'One overwritable column loses the first id'],
  ['src/reservations/confirm-booking.ts', 55, 'key: pi.paymentIntentId,'],
  ['src/reservations/booking-webhook.ts', 300, 'const idempotencyKey = charge.key;'],
  ['src/reservations/booking-webhook.ts', 329, 'const reservationId = reservationIdFor(idempotencyKey);'],
  ['src/reservations/write-booking.ts', 36, 'export function reservationIdFor(idempotencyKey: string): ReservationId {'],
  ['src/reservations/write-booking.ts', 37, 'createHash("sha256").update(idempotencyKey)'],
  ['src/reservations/booking-webhook.ts', 526, 'The money moved, and is NOT recorded here'],
  ['src/reservations/booking-webhook.ts', 530, 'if (result.outcome === "lost") {'],
  ['src/reservations/booking-webhook.ts', 549, 'idempotencyKey: `refund_${charge.key}`,'],
  ['src/domain/entities.ts', 905, 'export interface Payment {'],
  ['src/domain/entities.ts', 909, 'reservationId: ReservationId;'],
  ['src/reservations/create-departure-payment-intent.test.ts', 350, 'residual race on the PI path: loser auto-refunded keyed on the PI id'],
  ['src/reservations/create-departure-checkout.test.ts', 169, 'residual-race loss with NO payment_intent'],
  ['src/reservations/create-departure-checkout.test.ts', 183, 'residual race + auto-refund THROWS'],
  ['src/reservations/confirm-booking.test.ts', 134, 'does NOT refund or notify on a residual-race loss'],
  ['src/reservations/create-departure-payment-intent.test.ts', 356, 'const m = pay.intents[0]!.metadata;'],
  ['src/reservations/create-departure-payment-intent.test.ts', 361, 'outcome: "lost"'],
  ['src/reservations/booking-webhook.ts', 774, 'Writes NO `Payment`'],

  // ── Criterion 13's evidence (§Criterion 13) ──
  ['docs/SPEC.md', 2077, 'Killing the webhook entirely still produces a booking'],
  ['app/(public)/book/success/page.tsx', 5, 'SPEC §2.8 criterion 13'],
  ['app/(public)/book/success/page.tsx', 51, 'await confirmBookingByPaymentIntent('],
  ['src/reservations/confirm-booking.ts', 87, 'export async function confirmBookingByPaymentIntent('],
  ['src/reservations/confirm-booking.ts', 91, 'await deps.payments.getSucceededPaymentIntent(paymentIntentId)'],
  ['src/reservations/confirm-booking.test.ts', 86, 'given only its id and no webhook at all'],
  ['src/reservations/confirm-booking.test.ts', 103, 'the webhook landing afterwards produces no second booking'],
  ['src/reservations/confirm-booking.test.ts', 121, 'the redirect is not proof'],
  ['src/reservations/confirm-booking.test.ts', 169, 'metadata-less intent behind a hosted balance checkout'],
  // Issue #831, verified rather than taken from the page's docstring: `won` is a read after the
  // write, so two racing callers can both observe the row and both be told `booked`.
  ['src/adapters/postgres-repository.ts', 1668, 'select 1 from reservations where id=$1'],
  ['src/adapters/postgres-repository.ts', 1672, 'won.rowCount === 1'],
  ['src/reservations/write-booking.ts', 168, 'outcome: "already", reservation: after'],
  ['src/adapters/stripe-payment.ts', 160, 'if (pi.status !== "succeeded") return null;'],
  ['src/reservations/booking-webhook.ts', 475, 'if (result.outcome === "booked") {'],
  ['src/adapters/in-memory-repository.ts', 522, 'Insert-only (mirrors the postgres `on conflict do nothing`)'],

  // ── Criterion 14's evidence (§Criterion 14) ──
  ['docs/SPEC.md', 2078, 'Closing the browser at the moment of payment still produces a booking'],
  ['src/reservations/booking-webhook.test.ts', 126, 'booked: writes the reservation + records the payment'],
  ['src/reservations/booking-webhook.test.ts', 292, 'a throwing sendConfirmation never breaks the committed booking'],
  ['app/lib/booking-confirmation.ts', 32, 'if (process.env.MESSAGING === "false") return;'],
  ['app/lib/booking-confirmation.ts', 49, 'confirmation skipped — no email or SMS channel configured'],
  ['docs/DEPLOY.md', 111, '`MESSAGING=0` leaves booking confirmations ON'],
  ['app/lib/booking-confirmation.ts', 58, "The operator's resend recovers it."],
  ['app/lib/booking-confirmation.ts', 59, 'await ensureBookingCode(repo, reservation.id'],
  ['app/(public)/book/checkout/checkout-form.tsx', 189, 'await p.stripe.confirmPayment({'],
  ['app/(public)/book/checkout/checkout-form.tsx', 193, 'return_url: p.returnUrl,'],

  // ── Criterion 15's evidence (§Criterion 15) ──
  ['docs/SPEC.md', 2079, 'Kill the webhook, close the browser'],
  ['docs/SPEC.md', 1862, '**2.8.9 The reconciler — the job that catches payments whose webhook never landed.**'],
  ['docs/SPEC.md', 1865, 'retries on a backoff and eventually stops'],
  ['docs/SPEC.md', 1866, 'money taken, no booking, nobody told'],
  ['docs/SPEC.md', 1871, 'past its window is a work list'],
  ['docs/SPEC.md', 1874, "Stripe's undelivered-event feed"],
  ['docs/SPEC.md', 1879, 'Detection latency *is* the schedule'],
  ['docs/SPEC.md', 1882, 'safe to run at any time, in any order, more than once'],
  ['docs/SPEC.md', 1886, "The operator's pause does not stop it"],
  // The verdict, in the code's own words, in two files.
  ['src/reservations/confirm-booking.ts', 14, 'reconciler to run the SAME idempotent confirm'],
  ['app/lib/booking-deps.ts', 4, '(later) the reconciler'],
  // The four controls checked and ruled out (§Criterion 15). The alert call sites themselves are
  // already pinned under Criterion 7; not repeated here.
  ['app/api/cron/xola-pull/route.ts', 10, 'NO CRON IS ATTACHED'],
  ['app/(admin)/admin/purchases/page.tsx', 111, 'listAllReservations'],
  ['app/b/find/actions.ts', 71, 'r.event'],

  // ── Criterion 16's evidence (§Criterion 16) ──
  ['docs/SPEC.md', 2081, 'Confirming the same payment three times'],
  ['src/domain/entities.ts', 906, 'Deterministic from the Stripe checkout-session id'],
  ['src/adapters/postgres-repository.ts', 1600, 'on conflict do nothing'],
  // The SEQUENTIAL guard, which an earlier draft of §Criterion 16 missed: the repeat returns here,
  // before the Event id is computed at :96 and before the insert at :140 is reached.
  ['src/reservations/write-booking.ts', 103, 'if (prior) return { outcome: "already", reservation: prior };'],
  ['src/reservations/write-booking.ts', 105, 'const eventId = eventIdForSlot('],
  ['src/reservations/booking-webhook.ts', 415, 'result.outcome === "booked" || result.outcome === "already"'],
  ['src/adapters/postgres-repository.ts', 1398, 'on conflict (id) do nothing'],
  ['src/reservations/booking-webhook.test.ts', 163, 'listPaymentsForReservation'],
  ['src/adapters/repository-contract.ts', 878, 'no duplicate materialized (slot guardrail)'],
  ['src/reservations/create-departure-payment-intent.test.ts', 441, 'NOT the outcome gate'],
  ['src/reservations/create-departure-payment-intent.test.ts', 450, 'piEvent("pi_fake_1", 27570, m)'],
  ['src/reservations/create-departure-payment-intent.test.ts', 452, 'listGratuitiesForEvent'],
  ['src/reservations/booking-webhook.test.ts', 152, 'a re-delivered webhook (same session) is idempotent'],
  ['src/reservations/booking-webhook.test.ts', 161, 'listReservationsForEvent(EVENT)).toHaveLength(1)'],
  ['src/reservations/booking-webhook.test.ts', 564, 'expect(events).toHaveLength(1)'],

  // ── Criterion 17's evidence (§Criterion 17) ──
  ['docs/SPEC.md', 2082, 'Confirming produces a shift for that vessel-day'],
  // The formation itself, and the flag whose default used to be wrong (#765).
  ['src/reservations/booking-webhook.ts', 458, 'const form = await formShifts(deps.repo, {'],
  ['src/reservations/booking-webhook.ts', 460, 'notifyTripChanges: true,'],
  ['src/reservations/booking-webhook.ts', 462, 'await relayAndAudit(deps, form);'],
  ['src/reservations/booking-webhook.ts', 467, 'if (e instanceof PartialFormError) await relayAndAudit(deps, e.partial);'],
  ['src/reservations/booking-webhook.ts', 96, 'relayFormNotices?: (form: FormResult) => Promise<void>;'],
  // Both confirm paths funnel here, which is why the success page forms shifts too.
  ['src/reservations/confirm-booking.ts', 54, 'return processBookingCharge(deps, {'],
  ['app/api/webhooks/stripe/route.ts', 42, 'bookingDeps(secretKey, webhookSecret),'],
  ['app/(public)/book/success/page.tsx', 51, 'confirmBookingByPaymentIntent(bookingDeps(secretKey), paymentIntentId)'],
  ['app/lib/booking-deps.ts', 29, 'export function bookingDeps(secretKey: string, webhookSecret?: string): WebhookDeps {'],
  ['app/lib/booking-deps.ts', 46, 'relayFormNotices: forwardFormNotices,'],
  // The notify chain past the stubbed relay — each link separately.
  ['src/builder/form-shifts.ts', 423, 'const desired = deriveSeats(vessel, shiftId)'],
  ['src/builder/form-shifts.ts', 534, 'result.changedCrew.push({'],
  ['src/builder/form-notices.ts', 41, '...form.changedCrew'],
  ['src/builder/form-notices.ts', 45, 'action: "changed" as const,'],
  ['app/lib/channel.ts', 94, 'forwardNoticesToOutbox(formNoticeChanges(form, OPERATOR_CREW_MEMBER_ID))'],
  ['app/lib/channel.ts', 95, 'await recordFormChanges(form);'],
  ['app/lib/channel.ts', 117, 'if (form.changedCrew.length === 0) return'],
  ['src/builder/form-notices.test.ts', 61, 'maps changedCrew → changed, excluding the operator (#350)'],
  // The three-sided test set: seats, the day that grew, and the negative control.
  ['src/reservations/booking-webhook.test.ts', 513, 'Real manning, or the shift forms with zero seats'],
  ['src/reservations/booking-webhook.test.ts', 555, 'books a slot and lands a Shift with derived seats'],
  ['src/reservations/booking-webhook.test.ts', 605, 'a booking that GROWS an already-crewed day tells that crew (#765)'],
  ['src/reservations/booking-webhook.test.ts', 642, 'eventIds).toHaveLength(2)'],
  ['src/reservations/booking-webhook.test.ts', 651, '.toEqual(["cap-765"])'],
  ['src/reservations/booking-webhook.test.ts', 654, 'a booking that creates a BRAND-NEW shift still tells nobody (#765)'],
  ['src/reservations/booking-webhook.test.ts', 657, 'look identical'],
  ['src/reservations/booking-webhook.test.ts', 671, 'expect(form.changedCrew).toEqual([])'],
  ['src/reservations/booking-webhook.test.ts', 674, 'a relay failure does not cost the customer their paid booking'],
  ['src/reservations/booking-webhook.test.ts', 690, 'a formation failure does not cost the customer their paid booking'],
  // "With seats" is guarded outside the booking path — and only the second guard is general.
  ['src/admin/vessel-admin.ts', 81, 'if (manning.length === 0) return { ok: false, code: "crew_required" }'],
  ['app/(admin)/admin/shifts/page.tsx', 323, 'no manning rule rather than reporting it vacuously Crewed'],
  ['src/builder/derive.ts', 84, 'Shift has no required seats — the vessel has no manning rule (#582).'],
  // The gap the first guard does not cover: `.some()` is vacuously false on an empty array.
  ['src/admin/crew-admin.ts', 36, 'if (vessel.manning.some((m) => m.count < 1)) {'],
  ['src/admin/seed-brewboat.ts', 73, 'createVessel'],
  // The "only two triggers left" claim, and the six callers that falsify it.
  ['src/reservations/booking-webhook.ts', 93, 'this webhook is one of only two `formShifts` triggers in'],
  ['src/reservations/booking-webhook.ts', 443, 'this webhook and the cron tick are the only formation triggers left'],
  ['src/reservations/booking-webhook.ts', 452, 'this and the cron tick are the ONLY `formShifts` triggers'],
  ['app/api/cron/tick/route.ts', 75, 'await formShifts(repo, { now, notifyTripChanges: true })'],
  ['src/reservations/cancel-reservation.ts', 176, 'const form = await formShifts(deps.repo, {'],
  ['src/builder/merge.ts', 97, 'const form = await formShifts(repo, { notifyTripChanges: true'],
  ['src/builder/split.ts', 80, 'return formShifts(repo, { notifyTripChanges: true'],
  ['src/import/xola-pull.ts', 182, 'const formed = await formShifts(repo, {'],
  ['src/builder/form-shifts.ts', 135, 'export async function formShifts('],
  // Split across the line break at :101/:102 — the fourth time this session that a wrapped
  // sentence produced a citation that reads correct and pins nothing.
  ['app/lib/channel.ts', 102, 'and there are six'],
  // DEC-126 rules the cutover and nothing about the trigger set.
  ['docs/decisions/DEC-126-the-flip-is-a-cutover-with-a-one-time-full-xola.md', 11, 'app/api/cron/xola-pull/route.ts'],
  ['docs/decisions/DEC-126-the-flip-is-a-cutover-with-a-one-time-full-xola.md', 33, 'gone rather than amended'],

  // ── Criterion 18's evidence (§Criterion 18) ──
  ['docs/SPEC.md', 2084, 'Confirming a trip whose slot was previously booked and then cancelled'],
  // The resurrect, and the two carve-outs the criterion's wording does not cover.
  ['src/adapters/postgres-repository.ts', 1613, 'RESURRECT a cancelled slot (#616)'],
  ['src/adapters/postgres-repository.ts', 1635, "set status = 'scheduled', capacity = $4, price = $5, duration_minutes = $6"],
  ['src/adapters/postgres-repository.ts', 1637, "and source='muster' and status='cancelled'"],
  ['src/adapters/postgres-repository.ts', 1627, 'of the booking, and the candidate never carries one'],
  ['src/adapters/postgres-repository.ts', 1631, 'a predicate that could also match a LIVE slot'],
  ['src/adapters/postgres-repository.ts', 1655, 'slot un-materializable (e.g. cancelled) — no oversell'],
  // The status-agnostic index that makes cancelling brick the slot without the resurrect.
  ['db/migrations/20260718142705_claim_hold_mutex.sql', 28, 'create unique index if not exists events_muster_slot_identity'],
  ['db/migrations/20260718142705_claim_hold_mutex.sql', 30, "where source = 'muster';"],
  // The surface half — a cancelled row leaves the materialized branch and the hull.
  ['src/reservations/availability.ts', 375, 'if (e.source === "muster" && e.status === "scheduled") {'],
  ['src/reservations/hull-busy.ts', 81, 'if (e.status !== "scheduled") continue;'],
  // The real cancel path reaches the same two-row state the tests set up by hand.
  ['src/reservations/cancel-reservation.ts', 162, 'const cancelledEvent = await deps.repo.cancelEventIfUnclaimed(eventId)'],
  // Coverage: real Postgres at the writeSlotBooking level, both adapters at the contract level.
  ['src/adapters/postgres-repository.test.ts', 623, 'the same slot can be SOLD AGAIN after a cancellation'],
  ['src/adapters/postgres-repository.test.ts', 559, 'filters on `status === "scheduled"`, misses the cancelled row'],
  ['src/adapters/postgres-repository.test.ts', 653, 'cancelling the reservation alone does not'],
  ['src/adapters/repository-contract.ts', 1840, 're-freezes price and duration IDENTICALLY on both adapters (#616)'],
  ['src/adapters/repository-contract.ts', 1843, "kept the DEAD booking's numbers"],
  ['src/adapters/repository-contract.ts', 1891, 'expect(revived?.capacity).toBe(8)'],
  ['src/adapters/repository-contract.ts', 1892, 'expect(revived?.price).toBeUndefined()'],
  ['src/adapters/repository-contract.ts', 820, 'a CANCELLED reservation on the slot does not block a re-claim'],
  // The composition above it, which nothing exercises and which has no cancelled-slot branch.
  ['src/reservations/write-booking.ts', 111, 'const candidateEvent: Event = {'],
  // The in-memory adapter handles the case deliberately NOW — so the pg test's comment quoting
  // its accidental old shape is a record of the fix rather than a description of live code.
  ['src/adapters/in-memory-repository.ts', 646, 'here the same case used to be handled BY ACCIDENT'],
  ['src/adapters/in-memory-repository.ts', 654, 'Same field policy as the pg adapter'],
  ['src/adapters/in-memory-repository.ts', 656, 'const cancelled = [...this.#events.values()].find('],
  ['src/adapters/in-memory-repository.ts', 675, 'delete revived.price;'],
  ['src/adapters/in-memory-repository.ts', 677, 'if (event.price !== undefined) revived.price = event.price;'],

  // ── Criterion 19's evidence (§Criterion 19) ──
  ['docs/SPEC.md', 2086, 'A booking-charge payment that matches no reservation alerts every active admin by SMS'],
  // The seven branches that fit "a booking charge matching no reservation" — two name the amount.
  // The last two declare a non-booking `purpose`, so they are listed with the argument rather
  // than silently excluded (code review caught the five-row version).
  ['src/reservations/booking-webhook.ts', 178, 'if (purpose !== undefined && purpose !== "booking") {'],
  ['src/reservations/booking-webhook.ts', 180, 'Stripe checkout with unknown purpose='],
  ['src/reservations/confirm-booking.ts', 49, 'Stripe payment intent with unknown purpose='],
  ['src/reservations/booking-webhook.ts', 522, 'const who = `${m.customerName || "customer"} party of ${partySize}`;'],
  ['src/reservations/booking-webhook.ts', 292, 'await deps.alertPaidButUnbooked('],
  ['src/reservations/booking-webhook.ts', 321, 'PAID but NOT booked - booking session ${charge.key} carries no slot'],
  ['src/reservations/booking-webhook.ts', 322, '(${charge.amountCents} ${charge.currency})'],
  ['src/reservations/booking-webhook.ts', 350, 'PAID but NOT booked - unusable booking metadata on Stripe charge'],
  ['src/reservations/booking-webhook.ts', 533, 'Residual-race loss with NO payment_intent to auto-refund'],
  ['src/reservations/booking-webhook.ts', 560, 'Residual-race loss AND the auto-refund FAILED'],
  // The ONE call site that guards against a throwing alert, and the 500 the others reach.
  ['src/reservations/booking-webhook.ts', 354, '.catch(() => {'],
  ['src/reservations/booking-webhook.ts', 355, 'An alert failure must not replace the underlying error'],
  ['app/api/webhooks/stripe/route.ts', 57, 'return NextResponse.json({ error: "processing failed" }, { status: 500 });'],
  // The delivery half — fan-out to every active admin, best-effort per recipient.
  ['src/adapters/forward-money-alert.ts', 45, 'recipients = await listActiveAdminRecipients(repo)'],
  ['src/adapters/forward-money-alert.ts', 29, 'one dead number cannot mute the rest'],
  ['src/adapters/forward-money-alert.ts', 16, 'One emoji or one em dash forces the whole'],
  ['src/adapters/forward-money-alert.test.ts', 51, 'texts every active admin and reports how many landed'],
  ['src/adapters/forward-money-alert.test.ts', 80, 'one dead number cannot mute the other admins'],
  ['src/adapters/forward-money-alert.test.ts', 96, 'returns 0 rather than throwing when there is nobody to tell'],
  ['src/adapters/forward-money-alert.test.ts', 106, 'swallows a repository outage'],
  ['src/adapters/forward-money-alert.test.ts', 77, 'expect(body).toContain("53625")'],
  // The fixture that says "verbatim" and is not — against the copy that actually ships.
  ['src/adapters/forward-money-alert.test.ts', 19, 'Verbatim from `booking-webhook.ts` — the copy that actually ships.'],
  ['src/adapters/forward-money-alert.test.ts', 22, 'which matches NO payment in Muster - RECONCILE MANUALLY.'],
  ['src/reservations/booking-webhook.ts', 677, 'which matches NO payment in Muster. The ledger is unchanged;'],
  // The edge holds the never-throws guarantee the core assumes, and nothing tests either half.
  ['app/lib/alert.ts', 45, 'The log line is the floor, not the fallback'],
  ['app/lib/alert.ts', 49, 'Never throws, for the same reason the core sender doesn'],
  ['app/lib/alert.ts', 59, 'console.error(`[reservations] ${message}`);'],
  ['app/lib/alert.ts', 64, 'Twilio-dark ⇒ the log line above is the whole alert'],
  ['app/lib/alert.ts', 66, 'money alert reached NO admin (none reachable)'],
  // The only test of an unmatched BOOKING charge, and what it asserts about the body.
  ['src/reservations/booking-webhook.test.ts', 184, 'refuses a legacy eventId-shaped session: alerts, books nothing (#693)'],
  ['src/reservations/booking-webhook.test.ts', 196, 'toContain("REFUND MANUALLY")'],
  ['src/reservations/booking-webhook.test.ts', 200, 'toBeNull()'],

  // ── Criterion 20's evidence (§Criterion 20) ──
  ['docs/SPEC.md', 2090, "Editing the offering's price, hold minutes, trip time or schedule while a reservation is pending changes"],
  // Price: resolved at intent creation, carried through Stripe, read back from the request.
  ['src/reservations/create-departure-payment-intent.ts', 133, 'const priceCents = slotEvent?.price ?? resolveBasePrice(offering!, hold.date)'],
  ['src/reservations/create-departure-payment-intent.ts', 235, 'priceCents: String(priceCents),'],
  ['src/reservations/write-booking.ts', 121, 'price: req.priceCents,'],
  // Trip time: a LIVE read of the offering at confirm, four lines after the frozen price.
  ['src/reservations/write-booking.ts', 124, 'long a trip that already ran was'],
  ['src/reservations/write-booking.ts', 130, '...(durationMinutes !== undefined ? { durationMinutes } : {}),'],
  // …and that field is exactly what occupancy is measured by.
  ['src/reservations/hull-busy.ts', 93, 'out.push({ start, end: start + (e.durationMinutes ?? XOLA_TRIP_MINUTES) });'],
  ['src/domain/entities.ts', 599, 'frozen here at materialization'],
  ['src/domain/entities.ts', 604, 'shiftEndFromEvents'],
  // The test named for the freeze — the edit lands AFTER the booking, which is the other window.
  ['src/reservations/write-booking.test.ts', 109, 'FROZEN, not resolved on read: editing the offering later leaves the booked event alone'],
  ['src/reservations/write-booking.test.ts', 115, 'const r = await bookSlot(repo);'],
  ['src/reservations/write-booking.test.ts', 119, 'await repo.saveOffering(offering({ tripLengthMinutes: 90 }));'],
  ['src/reservations/write-booking.test.ts', 121, 'durationMinutes).toBe(240)'],
  // The two things both called "hold minutes".
  ['src/domain/entities.ts', 358, 'holdMinutes?: number;'],
  ['src/reservations/pending.ts', 60, 'Resolved once at import'],
  ['src/reservations/pending.ts', 62, 'export const HOLD_MINUTES = resolveHoldMinutes();'],
  ['src/reservations/claim.ts', 49, 'export function holdExpiry(asOf: string): string {'],
  ['src/reservations/claim.ts', 288, 'expiresAt: holdExpiry(at),'],
  // §2.8.4 step 3 ALREADY specifies the freeze this criterion asks for — the fix is not new.
  ['docs/SPEC.md', 1572, 'freeze the money, the hold minutes and the trip time onto it'],
  // Split at the line break (:1575/:1576) — the fifth this session.
  ['docs/SPEC.md', 1580, 'a tax rate, a service fee, a price or a trip time can'],
  ['docs/SPEC.md', 1581, 'change between the quote and the payment'],
  ['docs/decisions/DEC-161-occupancy-is-measured-in-hold-minutes-not-trip-time.md', 18, '2.8.4a freezes both durations'],
  ['docs/decisions/DEC-161-occupancy-is-measured-in-hold-minutes-not-trip-time.md', 39, 'Both durations freeze onto the reservation.'],
  // DEC-164 sits in the same amendment banner and rejects the mechanism the price freeze uses
  // today — the timing is right, the storage is not, and #812 is the retool.
  ['docs/decisions/DEC-164-the-frozen-money-is-one-value-on-our-own-row.md', 8, 'not in Stripe metadata'],
  ['docs/decisions/DEC-164-the-frozen-money-is-one-value-on-our-own-row.md', 25, 'already forbid it, and issue #812 asks for the retool'],
  ['docs/decisions/DEC-164-the-frozen-money-is-one-value-on-our-own-row.md', 27, 'Number(charge.metadata.taxCents ?? 0)'],
  ['docs/decisions/DEC-164-the-frozen-money-is-one-value-on-our-own-row.md', 36, 'Rejected: leaving it at Stripe.'],
  ['docs/SPEC.md', 1481, 'Amended by DEC-164'],
  // The pause is the answer for the settings-shaped REFUSALS (criterion 5), not for a frozen value.
  ['docs/SPEC.md', 1803, 'Nothing is re-validated at confirm.'],
  ['src/ports/repository.ts', 762, 'isEnginePaused(): Promise<boolean>;'],
  // Why the duration is read late today: no pending row exists to carry it, and the hold has no
  // duration field either (criterion 4's finding from the other direction).
  ['src/domain/entities.ts', 831, 'export interface CheckoutHold {'],
  // The offering edit path, which has no guard on live holds.
  ['src/admin/offering-admin.ts', 212, '...(input.tripLengthMinutes !== undefined'],
  ['src/admin/offering-admin.ts', 215, '...(input.holdMinutes !== undefined ? { holdMinutes: input.holdMinutes } : {}),'],

  // ── Criterion 21's evidence (§Criterion 21) ──
  ['docs/SPEC.md', 2092, 'A balance payment never creates or confirms a reservation.'],
  // Depth 1 — the dispatch returns nine lines before the booking path.
  ['src/reservations/booking-webhook.ts', 174, 'it must NEVER reach the booking path'],
  ['src/reservations/booking-webhook.ts', 176, 'if (purpose === "balance") return recordBalancePayment(deps, completed);'],
  ['src/reservations/booking-webhook.ts', 185, 'return processBookingCharge(deps, {'],
  // Depth 2 — the function it lands in writes one Payment and nothing else.
  ['src/reservations/booking-webhook.ts', 812, 'async function recordBalancePayment('],
  ['src/reservations/booking-webhook.ts', 840, 'violate the FK, throw, and take this alert with it'],
  ['src/reservations/booking-webhook.ts', 851, 'await deps.repo.savePayment(payment);'],
  ['src/reservations/booking-webhook.ts', 881, 'return { handled: true, outcome: "balance_paid" };'],
  // …and the two calls that WOULD book, both above :570 and both inside processBookingCharge.
  ['src/reservations/booking-webhook.ts', 382, 'const result: SlotBookingResult = await writeSlotBooking('],
  ['src/reservations/booking-webhook.ts', 482, 'await deps.sendConfirmation(result.reservation);'],
  // Depth 3 — a balance session that lost its `purpose` still fails the slot test.
  ['src/reservations/booking-webhook.ts', 318, 'const isSlotBooking = Boolean(m.vesselId && m.date && m.time && m.offeringId);'],
  // Both doors, tested.
  ['src/reservations/booking-webhook.test.ts', 366, 'no second reservation, no alert'],
  ['src/reservations/booking-webhook.test.ts', 378, 'did NOT run the booking path'],
  ['src/reservations/booking-webhook.test.ts', 379, 'listReservationsForEvent(EVENT)).toHaveLength(1)'],
  ['src/reservations/confirm-booking.test.ts', 169, 'does NOT book the metadata-less intent behind a hosted balance checkout'],
  ['src/reservations/confirm-booking.test.ts', 188, 'listAllReservations()).toHaveLength(0)'],
  // Dormant at TWO layers. The pane hides the button — this is the one the operator meets, and
  // the one an earlier draft of this section missed (code review).
  ['app/(admin)/admin/calendar/[reservationId]/actions.ts', 82, 'export async function createBalanceLink(formData: FormData): Promise<void> {'],
  ['app/(admin)/admin/calendar/[reservationId]/reservation-detail-pane.tsx', 506, 'Shown only when money is actually owed'],
  ['app/(admin)/admin/calendar/[reservationId]/reservation-detail-pane.tsx', 528, 'money.balanceCents > 0 &&'],
  ['app/(admin)/admin/calendar/[reservationId]/reservation-detail-pane.tsx', 551, '<form action={createBalanceLink}>'],
  // …and the server refuses, covering the stale tab and the re-post.
  ['src/reservations/create-balance-checkout.ts', 52, 'folds no_balance, already-paid, and full-mode into one predicate'],
  ['src/reservations/create-balance-checkout.ts', 53, 'if (owed <= 0) return { ok: false, reason: "no_balance" };'],
  // The "courtesy" comment belongs to the DISPUTED guard, not to no_balance — pinned so the
  // distinction cannot quietly re-collapse.
  ['src/reservations/create-balance-checkout.ts', 60, "The pane's button is a courtesy"],
  ['src/reservations/create-balance-checkout.ts', 63, 'p.status === "disputed" || p.status === "dispute_lost"'],
  ['src/reservations/create-balance-checkout.test.ts', 167, 'no_balance once paid in full'],
  ['src/reservations/payment-config.test.ts', 66, 'full mode charges fare + tax + fee in one go'],

  // ── Criterion 22's evidence (§Criterion 22) ──
  ['docs/SPEC.md', 2094, 'The tip pool for a trip divides evenly across the confirmed holders of its **required**'],
  ['docs/SPEC.md', 1653, "of that shift's **required** seats, deduped."],
  ['docs/SPEC.md', 1655, 'Supernumerary seats are not in the split'],
  ['docs/SPEC.md', 1658, 'crew sorted by id, the first `pool mod n` of them receive one extra cent'],
  ['docs/SPEC.md', 1916, 'The crew tip pool pays out on `booked`'],
  // Two layers: the pure split, and the wiring that decides who is in the denominator.
  ['src/admin/gratuity-payroll.ts', 48, 'export function splitGratuity(input: GratuitySplitInput): GratuitySplit {'],
  ['src/admin/gratuity-payroll.ts', 102, 'export async function buildGratuityPayroll('],
  ['src/admin/gratuity-payroll.ts', 112, 'const crew = new Set<string>();'],
  ['src/admin/gratuity-payroll.ts', 114, 'if (seat.state === "Confirmed" && seat.kind === "required" && seat.assignedCrewMemberId) {'],
  ['src/admin/gratuity-payroll.ts', 120, 'crewByEvent.set(String(eventId), [...crew]);'],
  // Cents exact — floor, remainder, lexical +1.
  ['src/admin/gratuity-payroll.ts', 69, 'const per = Math.floor(poolCents / crew.length);'],
  ['src/admin/gratuity-payroll.ts', 70, 'const rem = poolCents % crew.length;'],
  ['src/admin/gratuity-payroll.ts', 72, '(i < rem ? 1 : 0)'],
  // The warning, and the filter that runs BEFORE it (the boundary the warning does not cover).
  ['src/admin/gratuity-payroll.ts', 66, 'in gratuity but no confirmed crew — unsplit'],
  ['src/admin/gratuity-payroll.ts', 110, 'if (shift.state === "Cancelled") continue;'],
  ['src/admin/gratuity-payroll.ts', 127, '.filter(isBooked)'],
  ['src/admin/gratuity-payroll.ts', 131, '(g) => eventsInWindow.has(String(g.eventId)) && bookedResIds.has(String(g.reservationId)),'],
  // The comment that names a contract test which does not exist.
  ['src/admin/gratuity-payroll.ts', 45, 'a contract-test invariant'],
  // Tests: even, remainder + sum, zero-crew warning, the report's join, the cancelled shift's silence.
  ['src/admin/gratuity-payroll.test.ts', 41, 'distributes the remainder deterministically to the lexically-first crew'],
  ['src/admin/gratuity-payroll.test.ts', 52, 'toBe(1001); // every cent allocated'],
  ['src/admin/gratuity-payroll.test.ts', 66, 'a pool with no crew is unsplit + warned'],
  ['src/admin/gratuity-payroll.test.ts', 101, 'kind: "required", state: "Confirmed",'],
  ['src/admin/gratuity-payroll.test.ts', 121, 'splits a booked event\'s pool among its confirmed crew and joins Gusto identity'],
  ['src/admin/gratuity-payroll.test.ts', 147, 'a cancelled shift takes its event out of scope (nobody paid)'],
  ['src/admin/payroll-reconcile.test.ts', 308, 'a supernumerary seat is never missing — an unpaid ride owes no hours'],
  // The operator sees the warning; the combined report carries it.
  ['app/(admin)/admin/payroll/page.tsx', 193, '{tips.warnings.length > 0 && ('],
  ['src/admin/payroll-reconcile.ts', 141, 'const warnings = [...tips.warnings];'],
  // Reachability of the silent case: who writes gratuities, who cancels events.
  ['src/reservations/booking-webhook.ts', 502, 'if (isSlotBooking && gratuityCents > 0) {'],
  ['src/reservations/booking-webhook.ts', 791, 'await deps.repo.saveGratuity({'],
  ['src/reservations/cancel-reservation.ts', 143, 'status: "cancelled",'],
  ['src/reservations/cancel-reservation.ts', 162, 'const cancelledEvent = await deps.repo.cancelEventIfUnclaimed(eventId);'],
  ['src/adapters/repository-contract.ts', 1682, '// ── Gratuity (DEC-124, 12.3)'],
  // The shift-canceller an earlier draft said did not exist yet (code review), and the call that
  // reaches it from the cancellation path. Pinned because the safety argument now turns on them.
  ['src/builder/form-shifts.ts', 361, 'if (scheduled.length === 0) {'],
  ['src/builder/form-shifts.ts', 367, 'await repo.saveShift({ ...existing, state: "Cancelled" });'],
  ['src/reservations/cancel-reservation.ts', 165, 'Re-form so the shift collapses and its crew are told'],
  ['src/reservations/cancel-reservation.ts', 176, 'const form = await formShifts(deps.repo, {'],
  // The second caller's fixtures — also all required/Confirmed, so it adds no exclusion coverage.
  ['src/reservations/seed-gratuity.ts', 95, 'kind: "required",'],

  // ── Criterion 23's evidence (§Criterion 23) ──
  // The rewritten criterion, and the decision that rewrote it.
  ['docs/SPEC.md', 2097, 'A reservation with no payment recorded still occupies its hull'],
  ['docs/SPEC.md', 2098, 'consults a payment row.'],
  ['docs/SPEC.md', 1482, 'Amended by DEC-165'],
  ['docs/decisions/DEC-165-occupancy-never-reads-a-payment-row.md', 8, 'A reservation holds a boat because it exists, not because it is paid'],
  // Shape 1, read side — every scheduled event, no source filter, no payment.
  ['src/reservations/availability.ts', 380, 'Hull occupancy from EVERY scheduled event, both sources'],
  ['src/reservations/availability.ts', 388, 'for (const e of events) {'],
  ['src/reservations/availability.ts', 389, 'if (e.status !== "scheduled") continue;'],
  ['src/reservations/availability.test.ts', 370, 'a XOLA trip on the hull takes the slot off the market'],
  // The fixture is the point: events only, no reservations — the EVENT occupies the hull.
  ['src/reservations/availability.test.ts', 375, 'events: [ev("x1", { source: "xola", date: "2026-07-04", time: "13:30" })],'],
  // Shape 1, write side — contract-level, so proven on real Postgres too.
  ['src/adapters/repository-contract.ts', 736, 'saveBookingIfSlotFree: LOSES when a Xola trip already holds the hull'],
  ['src/adapters/repository-contract.ts', 741, 'event({ id: asId<"EventId">("evt-xola-hull"), source: "xola", time: "14:00" }),'],
  ['src/adapters/repository-contract.ts', 748, "expect(res.result).toBe(\"lost\");"],
  ['src/adapters/repository-contract.ts', 752, 'saveBookingIfSlotFree: LOSES on an OVERLAPPING time, not just the same one'],
  ['src/adapters/repository-contract.ts', 766, 'an untimed existing trip is measured at the STANDING length'],
  // Both write-path implementations, named so the "no payment input" claim is checkable.
  ['src/adapters/postgres-repository.ts', 1521, 'async saveBookingIfSlotFree('],
  ['src/adapters/in-memory-repository.ts', 594, 'async saveBookingIfSlotFree('],
  // Why an imported reservation cannot be paid: the importer writes an Event and a Reservation only.
  ['src/import/import-reservations.ts', 245, 'await repo.saveEvent(event);'],
  ['src/import/import-reservations.ts', 306, 'await repo.saveReservation(reservation);'],
  ['src/import/import-reservations.ts', 287, 'source: "xola", // imported reservations are Xola-owned (DEC-106)'],
  // Shape 2 — the hold occupies on a clock comparison, not on money.
  ['src/reservations/availability.ts', 362, 'if (h.source === "muster" && h.expiresAt > input.asOf) {'],
  ['src/reservations/availability.test.ts', 677, "a live hold (expiresAt > asOf) marks the slot 'held'"],
  ['src/reservations/availability.test.ts', 686, 'an EXPIRED hold contributes nothing'],

  // ── Criterion 24's evidence (§Criterion 24) ──
  ['docs/SPEC.md', 2101, 'booking-recovery lookup returns nothing'],
  // THE line. A deny-list on one status, where the criterion needs an allow-list — pinned on the
  // filter expression itself, because the whole finding is which operator is on it.
  ['src/reservations/find-booking.ts', 81, 'candidates.filter((c) => isBooked(c.reservation))'],
  ['src/reservations/find-booking.ts', 82, 'const pool = live.length > 0 ? live : candidates;'],
  // The cancelled rule is deliberate and explained — it is not the defect, and must not read as one.
  ['src/reservations/find-booking.ts', 79, 'A cancelled booking is still recoverable'],
  // Nothing upstream filters by status: the edge maps every row, the orchestrator passes them on.
  ['app/b/find/actions.ts', 62, 'repo.listAllReservations(),'],
  ['app/b/find/actions.ts', 69, 'event: eventById.get(String(reservation.eventId)),'],
  ['app/b/find/actions.ts', 71, '.filter((r): r is RecoveryRow => r.event !== undefined);'],
  ['src/reservations/recover-booking-link.ts', 93, 'const match = matchBookingForRecovery(await loadRows(), query, deps.today);'],
  // Why a wrong match is worse than a wrong row: the match is written to, then sent.
  ['src/reservations/recover-booking-link.ts', 98, 'const code = await ensureBookingCode(deps.repo, match.reservation.id, deps.now);'],
  ['src/reservations/ensure-booking-code.ts', 63, 'await repo.saveBookingCode(row);'],
  // Coverage: the only status-aware case, and it is the cancelled rule.
  ['src/reservations/find-booking.test.ts', 116, 'skips cancelled bookings when a live one exists, but recovers one if that is all there is'],
  // The union that makes this vacuous today — shared with criteria 6 and 11.
  ['src/domain/entities.ts', 625, 'ReservationStatus = "pending" | "booked" | "cancelled"'],

  // ── Criterion 2 / 5 evidence, spot-checked while re-baselining ──
  ['src/reservations/availability.ts', 176, 'return asId<"EventId">(`slot_${slotIdentity('],
  ['app/(public)/book/page.tsx', 92, 'repo.listLiveCheckoutHolds(asOf)'],
  ['src/reservations/claim.ts', 292, 'await repo.acquireCheckoutHold(hold)'],
  ['src/adapters/in-memory-repository.ts', 469, 'async cancelEventIfUnclaimed('],
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
