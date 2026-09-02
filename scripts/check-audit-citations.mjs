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

  // ── Criterion 9's evidence (§Criterion 9) ──
  ['docs/SPEC.md', 2061, 'An abandoned checkout is still on disk afterwards as an `expired` reservation'],
  ['docs/SPEC.md', 2063, 'is a query.'],
  ['src/domain/entities.ts', 739, 'guestCount: number;'],
  ['src/domain/entities.ts', 743, 'createdAt: string;'],
  ['src/adapters/postgres-repository.ts', 1680, "delete from checkout_holds where source='muster' and expires_at <= $1"],
  ['src/adapters/postgres-repository.ts', 1673, 'grew the table without bound'],
  ['src/adapters/in-memory-repository.ts', 739, 'h.expiresAt <= hold.createdAt'],
  ['src/reservations/create-departure-payment-intent.ts', 94, 'await acquireDepartureHold('],
  ['src/reservations/create-departure-payment-intent.ts', 153, 'await payments.createPaymentIntent('],
  ['db/migrations/0024_audit_events.sql', 1, 'crew audit log (#400, DEC-118)'],
  // §2.8.8's three mechanisms. Pinned individually because an earlier draft of §Criterion 9 read
  // the subsection's title — "Expiry is a clock, not a job" — and stopped, concluding §2.8 had no
  // answer to unbounded growth. It specifies two jobs, twenty lines below the title.
  ['docs/SPEC.md', 1829, 'A pending reservation stops occupying its boat the moment its window runs out'],
  ['docs/SPEC.md', 1833, 'it relabels lapsed `pending` rows to `expired`'],
  ['docs/SPEC.md', 1836, 'The sweeper never labels a row it cannot prove was unpaid'],
  ['docs/SPEC.md', 1841, 'deletes old `expired` rows so the table does not'],
  ['docs/SPEC.md', 1846, 'The sweeper never deletes, and this is load-bearing rather than tidy'],
  ['docs/SPEC.md', 1852, 'hulls tied up for people who were never going to buy'],
  ['docs/SPEC.md', 1823, "an operator's booking, `source`"],
  ['db/migrations/20260718142705_claim_hold_mutex.sql', 33, 'create table if not exists checkout_holds ('],

  // ── Criterion 10's evidence (§Criterion 10) ──
  ['docs/SPEC.md', 2064, 'A declined card retried on the same trip reuses the same reservation'],
  ['docs/SPEC.md', 1742, 'A retry is matched by possession, never by claimed identity'],
  ['docs/SPEC.md', 1744, 'It must never be the typed email or phone'],
  ['src/reservations/claim.ts', 120, 'export interface DepartureHoldRequest {'],
  ['src/reservations/claim.ts', 133, 'holderToken?: string | undefined;'],
  ['src/reservations/claim.ts', 257, 'Matched on POSSESSION of the holder token, never on the buyer'],
  ['src/reservations/claim.ts', 265, 'h.holderToken === holderToken'],
  ['src/reservations/claim.ts', 281, 'Returned with its ORIGINAL expiry, not a fresh one'],
  ['src/reservations/claim.ts', 284, 'return { held: mine };'],
  ['src/reservations/claim.test.ts', 421, 'expect("held" in first && "held" in second).toBe(true)'],
  ['src/reservations/claim.test.ts', 423, 'expect(second.held.expiresAt).toBe(first.held.expiresAt)'],
  ['src/reservations/holder-token.ts', 4, 'Why possession and not identity'],
  ['src/reservations/holder-token.ts', 27, 'return bytes(32).toString("base64url");'],
  ['src/reservations/holder-token.ts', 32, 'const HOLDER_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/'],
  ['app/(public)/book/checkout/actions.ts', 102, 'httpOnly: true,'],
  ['app/(public)/book/checkout/actions.ts', 106, 'sameSite: "lax",'],
  ['src/reservations/claim.test.ts', 397, 'returns the SAME hold on a retry instead of taking a second boat'],
  ['src/reservations/claim.test.ts', 410, 'does NOT extend the expiry — a retry cannot park a boat indefinitely'],
  ['src/reservations/claim.test.ts', 439, 'takes a bigger boat when the retry no longer FITS'],
  ['src/reservations/claim.test.ts', 498, 'two sessions with NO token never share a hold'],
  ['src/reservations/claim.test.ts', 513, 'an EXPIRED hold of the same buyer is not reused'],
  ['src/reservations/claim.test.ts', 524, 'does not reuse a hold from a different departure'],

  // ── Criterion 11's evidence (§Criterion 11) ──
  ['docs/SPEC.md', 2066, 'payment_intent.payment_failed'],
  ['src/adapters/stripe-payment.ts', 194, 'event.type === "checkout.session.completed"'],
  ['src/adapters/stripe-payment.ts', 209, 'event.type === "charge.refunded"'],
  ['src/adapters/stripe-payment.ts', 265, 'event.type === "payment_intent.succeeded"'],
  ['src/adapters/stripe-payment.ts', 277, 'return null;'],
  ['src/adapters/fake-payment.ts', 76, 'parseEvent'],
  ['src/reservations/booking-webhook.ts', 142, 'if (!event) return { handled: false };'],
  ['app/api/webhooks/stripe/route.ts', 21, 'Stripe dashboard nobody can read from the repo'],
  ['app/api/webhooks/stripe/route.ts', 46, 'return NextResponse.json({ received: true, ...result });'],
  ['src/reservations/booking-webhook.test.ts', 320, 'handled:false for a non-checkout event'],
  ['src/reservations/booking-webhook.test.ts', 84, 'getReservation(reservationIdFor("cs_test_1"))).toBeNull()'],

  // ── Criterion 12's evidence (§Criterion 12) ──
  ['docs/SPEC.md', 2067, 'superseded payment that succeeds late'],
  ['docs/SPEC.md', 1730, 'A reservation has many payment ids over its life, not one'],
  ['docs/SPEC.md', 1733, 'One overwritable column loses the first id'],
  ['src/reservations/confirm-booking.ts', 55, 'key: pi.paymentIntentId,'],
  ['src/reservations/booking-webhook.ts', 279, 'const idempotencyKey = charge.key;'],
  ['src/reservations/booking-webhook.ts', 308, 'const reservationId = reservationIdFor(idempotencyKey);'],
  ['src/reservations/write-booking.ts', 35, 'export function reservationIdFor(idempotencyKey: string): ReservationId {'],
  ['src/reservations/write-booking.ts', 36, 'createHash("sha256").update(idempotencyKey)'],
  ['src/reservations/booking-webhook.ts', 503, 'The money moved, and is NOT recorded here'],
  ['src/reservations/booking-webhook.ts', 507, 'if (result.outcome === "lost") {'],
  ['src/reservations/booking-webhook.ts', 526, 'idempotencyKey: `refund_${charge.key}`,'],
  ['src/domain/entities.ts', 801, 'export interface Payment {'],
  ['src/domain/entities.ts', 805, 'reservationId: ReservationId;'],
  ['src/reservations/create-departure-payment-intent.test.ts', 350, 'residual race on the PI path: loser auto-refunded keyed on the PI id'],
  ['src/reservations/create-departure-checkout.test.ts', 169, 'residual-race loss with NO payment_intent'],
  ['src/reservations/create-departure-checkout.test.ts', 183, 'residual race + auto-refund THROWS'],
  ['src/reservations/confirm-booking.test.ts', 134, 'does NOT refund or notify on a residual-race loss'],
  ['src/reservations/create-departure-payment-intent.test.ts', 356, 'const m = pay.intents[0]!.metadata;'],
  ['src/reservations/create-departure-payment-intent.test.ts', 361, 'outcome: "lost"'],
  ['src/reservations/booking-webhook.ts', 747, 'Writes NO `Payment`'],

  // ── Criterion 13's evidence (§Criterion 13) ──
  ['docs/SPEC.md', 2069, 'Killing the webhook entirely still produces a booking'],
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
  ['src/adapters/postgres-repository.ts', 1563, 'select 1 from reservations where id=$1'],
  ['src/adapters/postgres-repository.ts', 1567, 'won.rowCount === 1'],
  ['src/reservations/write-booking.ts', 152, 'outcome: "already", reservation: after'],
  ['src/adapters/stripe-payment.ts', 160, 'if (pi.status !== "succeeded") return null;'],
  ['src/reservations/booking-webhook.ts', 453, 'if (result.outcome === "booked") {'],
  ['src/adapters/in-memory-repository.ts', 515, 'Insert-only (mirrors the postgres `on conflict do nothing`)'],

  // ── Criterion 14's evidence (§Criterion 14) ──
  ['docs/SPEC.md', 2070, 'Closing the browser at the moment of payment still produces a booking'],
  ['src/reservations/booking-webhook.test.ts', 126, 'booked: writes the reservation + records the payment'],
  ['src/reservations/booking-webhook.test.ts', 292, 'a throwing sendConfirmation never breaks the committed booking'],
  ['app/lib/booking-confirmation.ts', 31, 'if (process.env.MESSAGING === "false") return;'],
  ['app/lib/booking-confirmation.ts', 48, 'confirmation skipped — no email or SMS channel configured'],
  ['docs/DEPLOY.md', 111, '`MESSAGING=0` leaves booking confirmations ON'],
  ['app/lib/booking-confirmation.ts', 57, "The operator's resend recovers it."],
  ['app/lib/booking-confirmation.ts', 58, 'await ensureBookingCode(repo, reservation.id'],
  ['app/(public)/book/checkout/checkout-form.tsx', 189, 'await p.stripe.confirmPayment({'],
  ['app/(public)/book/checkout/checkout-form.tsx', 193, 'return_url: p.returnUrl,'],

  // ── Criterion 15's evidence (§Criterion 15) ──
  ['docs/SPEC.md', 2071, 'Kill the webhook, close the browser'],
  ['docs/SPEC.md', 1858, '**2.8.9 The reconciler — the job that catches payments whose webhook never landed.**'],
  ['docs/SPEC.md', 1861, 'retries on a backoff and eventually stops'],
  ['docs/SPEC.md', 1862, 'money taken, no booking, nobody told'],
  ['docs/SPEC.md', 1867, 'past its window is a work list'],
  ['docs/SPEC.md', 1870, "Stripe's undelivered-event feed"],
  ['docs/SPEC.md', 1875, 'Detection latency *is* the schedule'],
  ['docs/SPEC.md', 1878, 'safe to run at any time, in any order, more than once'],
  ['docs/SPEC.md', 1882, "The operator's pause does not stop it"],
  // The verdict, in the code's own words, in two files.
  ['src/reservations/confirm-booking.ts', 14, 'reconciler to run the SAME idempotent confirm'],
  ['app/lib/booking-deps.ts', 4, '(later) the reconciler'],
  // The four controls checked and ruled out (§Criterion 15). The alert call sites themselves are
  // already pinned under Criterion 7; not repeated here.
  ['app/api/cron/xola-pull/route.ts', 10, 'NO CRON IS ATTACHED'],
  ['app/(admin)/admin/purchases/page.tsx', 105, 'listAllReservations'],
  ['app/b/find/actions.ts', 70, 'r.event'],

  // ── Criterion 16's evidence (§Criterion 16) ──
  ['docs/SPEC.md', 2073, 'Confirming the same payment three times'],
  ['src/domain/entities.ts', 802, 'Deterministic from the Stripe checkout-session id'],
  ['src/adapters/postgres-repository.ts', 1480, 'on conflict do nothing'],
  // The SEQUENTIAL guard, which an earlier draft of §Criterion 16 missed: the repeat returns here,
  // before the Event id is computed at :96 and before the insert at :140 is reached.
  ['src/reservations/write-booking.ts', 94, 'if (prior) return { outcome: "already", reservation: prior };'],
  ['src/reservations/write-booking.ts', 96, 'const eventId = eventIdForSlot('],
  ['src/reservations/booking-webhook.ts', 393, 'result.outcome === "booked" || result.outcome === "already"'],
  ['src/adapters/postgres-repository.ts', 1279, 'on conflict (id) do nothing'],
  ['src/reservations/booking-webhook.test.ts', 163, 'listPaymentsForReservation'],
  ['src/adapters/repository-contract.ts', 844, 'no duplicate materialized (slot guardrail)'],
  ['src/reservations/create-departure-payment-intent.test.ts', 441, 'NOT the outcome gate'],
  ['src/reservations/create-departure-payment-intent.test.ts', 450, 'piEvent("pi_fake_1", 27570, m)'],
  ['src/reservations/create-departure-payment-intent.test.ts', 452, 'listGratuitiesForEvent'],
  ['src/reservations/booking-webhook.test.ts', 152, 'a re-delivered webhook (same session) is idempotent'],
  ['src/reservations/booking-webhook.test.ts', 161, 'listReservationsForEvent(EVENT)).toHaveLength(1)'],
  ['src/reservations/booking-webhook.test.ts', 564, 'expect(events).toHaveLength(1)'],

  // ── Criterion 17's evidence (§Criterion 17) ──
  ['docs/SPEC.md', 2074, 'Confirming produces a shift for that vessel-day'],
  // The formation itself, and the flag whose default used to be wrong (#765).
  ['src/reservations/booking-webhook.ts', 436, 'const form = await formShifts(deps.repo, {'],
  ['src/reservations/booking-webhook.ts', 438, 'notifyTripChanges: true,'],
  ['src/reservations/booking-webhook.ts', 440, 'await relayAndAudit(deps, form);'],
  ['src/reservations/booking-webhook.ts', 445, 'if (e instanceof PartialFormError) await relayAndAudit(deps, e.partial);'],
  ['src/reservations/booking-webhook.ts', 94, 'relayFormNotices?: (form: FormResult) => Promise<void>;'],
  // Both confirm paths funnel here, which is why the success page forms shifts too.
  ['src/reservations/confirm-booking.ts', 54, 'return processBookingCharge(deps, {'],
  ['app/api/webhooks/stripe/route.ts', 42, 'bookingDeps(secretKey, webhookSecret),'],
  ['app/(public)/book/success/page.tsx', 51, 'confirmBookingByPaymentIntent(bookingDeps(secretKey), paymentIntentId)'],
  ['app/lib/booking-deps.ts', 29, 'export function bookingDeps(secretKey: string, webhookSecret?: string): WebhookDeps {'],
  ['app/lib/booking-deps.ts', 46, 'relayFormNotices: forwardFormNotices,'],
  // The notify chain past the stubbed relay — each link separately.
  ['src/builder/form-shifts.ts', 415, 'const desired = deriveSeats(vessel, shiftId)'],
  ['src/builder/form-shifts.ts', 525, 'result.changedCrew.push({'],
  ['src/builder/form-notices.ts', 41, '...form.changedCrew'],
  ['src/builder/form-notices.ts', 45, 'action: "changed" as const,'],
  ['app/lib/channel.ts', 93, 'forwardNoticesToOutbox(formNoticeChanges(form, OPERATOR_CREW_MEMBER_ID))'],
  ['app/lib/channel.ts', 94, 'await recordFormChanges(form);'],
  ['app/lib/channel.ts', 116, 'if (form.changedCrew.length === 0) return'],
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
  ['app/(admin)/admin/shifts/page.tsx', 313, 'no manning rule rather than reporting it vacuously Crewed'],
  ['src/builder/derive.ts', 84, 'Shift has no required seats — the vessel has no manning rule (#582).'],
  // The gap the first guard does not cover: `.some()` is vacuously false on an empty array.
  ['src/admin/crew-admin.ts', 36, 'if (vessel.manning.some((m) => m.count < 1)) {'],
  ['src/admin/seed-brewboat.ts', 73, 'createVessel'],
  // The "only two triggers left" claim, and the six callers that falsify it.
  ['src/reservations/booking-webhook.ts', 91, 'this webhook is one of only two `formShifts` triggers in'],
  ['src/reservations/booking-webhook.ts', 421, 'this webhook and the cron tick are the only formation triggers left'],
  ['src/reservations/booking-webhook.ts', 430, 'this and the cron tick are the ONLY `formShifts` triggers'],
  ['app/api/cron/tick/route.ts', 75, 'await formShifts(repo, { now, notifyTripChanges: true })'],
  ['src/reservations/cancel-reservation.ts', 169, 'const form = await formShifts(deps.repo, {'],
  ['src/builder/merge.ts', 97, 'const form = await formShifts(repo, { notifyTripChanges: true'],
  ['src/builder/split.ts', 80, 'return formShifts(repo, { notifyTripChanges: true'],
  ['src/import/xola-pull.ts', 182, 'const formed = await formShifts(repo, {'],
  ['src/builder/form-shifts.ts', 131, 'export async function formShifts('],
  // Split across the line break at :101/:102 — the fourth time this session that a wrapped
  // sentence produced a citation that reads correct and pins nothing.
  ['app/lib/channel.ts', 101, 'and there are six'],
  // DEC-126 rules the cutover and nothing about the trigger set.
  ['docs/decisions/DEC-126-the-flip-is-a-cutover-with-a-one-time-full-xola.md', 11, 'app/api/cron/xola-pull/route.ts'],
  ['docs/decisions/DEC-126-the-flip-is-a-cutover-with-a-one-time-full-xola.md', 33, 'gone rather than amended'],

  // ── Criterion 18's evidence (§Criterion 18) ──
  ['docs/SPEC.md', 2076, 'Confirming a trip whose slot was previously booked and then cancelled'],
  // The resurrect, and the two carve-outs the criterion's wording does not cover.
  ['src/adapters/postgres-repository.ts', 1493, 'RESURRECT a cancelled slot (#616)'],
  ['src/adapters/postgres-repository.ts', 1515, "set status = 'scheduled', capacity = $4, price = $5, duration_minutes = $6"],
  ['src/adapters/postgres-repository.ts', 1517, "and source='muster' and status='cancelled'"],
  ['src/adapters/postgres-repository.ts', 1507, 'of the booking, and the candidate never carries one'],
  ['src/adapters/postgres-repository.ts', 1511, 'a predicate that could also match a LIVE slot'],
  ['src/adapters/postgres-repository.ts', 1535, 'slot un-materializable (e.g. cancelled) — no oversell'],
  // The status-agnostic index that makes cancelling brick the slot without the resurrect.
  ['db/migrations/20260718142705_claim_hold_mutex.sql', 28, 'create unique index if not exists events_muster_slot_identity'],
  ['db/migrations/20260718142705_claim_hold_mutex.sql', 30, "where source = 'muster';"],
  // The surface half — a cancelled row leaves the materialized branch and the hull.
  ['src/reservations/availability.ts', 346, 'if (e.source === "muster" && e.status === "scheduled") {'],
  ['src/reservations/hull-busy.ts', 80, 'if (e.status !== "scheduled") continue;'],
  // The real cancel path reaches the same two-row state the tests set up by hand.
  ['src/reservations/cancel-reservation.ts', 155, 'const cancelledEvent = await deps.repo.cancelEventIfUnclaimed(reservation.eventId)'],
  // Coverage: real Postgres at the writeSlotBooking level, both adapters at the contract level.
  ['src/adapters/postgres-repository.test.ts', 571, 'the same slot can be SOLD AGAIN after a cancellation'],
  ['src/adapters/postgres-repository.test.ts', 507, 'filters on `status === "scheduled"`, misses the cancelled row'],
  ['src/adapters/postgres-repository.test.ts', 601, 'cancelling the reservation alone does not'],
  ['src/adapters/repository-contract.ts', 1613, 're-freezes price and duration IDENTICALLY on both adapters (#616)'],
  ['src/adapters/repository-contract.ts', 1616, "kept the DEAD booking's numbers"],
  ['src/adapters/repository-contract.ts', 1663, 'expect(revived?.capacity).toBe(8)'],
  ['src/adapters/repository-contract.ts', 1664, 'expect(revived?.price).toBeUndefined()'],
  ['src/adapters/repository-contract.ts', 788, 'a CANCELLED reservation on the slot does not block a re-claim'],
  // The composition above it, which nothing exercises and which has no cancelled-slot branch.
  ['src/reservations/write-booking.ts', 101, 'const candidateEvent: Event = {'],
  // The in-memory adapter handles the case deliberately NOW — so the pg test's comment quoting
  // its accidental old shape is a record of the fix rather than a description of live code.
  ['src/adapters/in-memory-repository.ts', 628, 'here the same case used to be handled BY ACCIDENT'],
  ['src/adapters/in-memory-repository.ts', 636, 'Same field policy as the pg adapter'],
  ['src/adapters/in-memory-repository.ts', 638, 'const cancelled = [...this.#events.values()].find('],
  ['src/adapters/in-memory-repository.ts', 657, 'delete revived.price;'],
  ['src/adapters/in-memory-repository.ts', 659, 'if (event.price !== undefined) revived.price = event.price;'],

  // ── Criterion 19's evidence (§Criterion 19) ──
  ['docs/SPEC.md', 2078, 'A booking-charge payment that matches no reservation alerts every active admin by SMS'],
  // The seven branches that fit "a booking charge matching no reservation" — two name the amount.
  // The last two declare a non-booking `purpose`, so they are listed with the argument rather
  // than silently excluded (code review caught the five-row version).
  ['src/reservations/booking-webhook.ts', 176, 'if (purpose !== undefined && purpose !== "booking") {'],
  ['src/reservations/booking-webhook.ts', 178, 'Stripe checkout with unknown purpose='],
  ['src/reservations/confirm-booking.ts', 49, 'Stripe payment intent with unknown purpose='],
  ['src/reservations/booking-webhook.ts', 499, 'const who = `${m.customerName || "customer"} party of ${partySize}`;'],
  ['src/reservations/booking-webhook.ts', 271, 'await deps.alertPaidButUnbooked('],
  ['src/reservations/booking-webhook.ts', 300, 'PAID but NOT booked - booking session ${charge.key} carries no slot'],
  ['src/reservations/booking-webhook.ts', 301, '(${charge.amountCents} ${charge.currency})'],
  ['src/reservations/booking-webhook.ts', 329, 'PAID but NOT booked - unusable booking metadata on Stripe charge'],
  ['src/reservations/booking-webhook.ts', 510, 'Residual-race loss with NO payment_intent to auto-refund'],
  ['src/reservations/booking-webhook.ts', 537, 'Residual-race loss AND the auto-refund FAILED'],
  // The ONE call site that guards against a throwing alert, and the 500 the others reach.
  ['src/reservations/booking-webhook.ts', 333, '.catch(() => {'],
  ['src/reservations/booking-webhook.ts', 334, 'An alert failure must not replace the underlying error'],
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
  ['src/reservations/booking-webhook.ts', 654, 'which matches NO payment in Muster. The ledger is unchanged;'],
  // The edge holds the never-throws guarantee the core assumes, and nothing tests either half.
  ['app/lib/alert.ts', 44, 'The log line is the floor, not the fallback'],
  ['app/lib/alert.ts', 48, 'Never throws, for the same reason the core sender doesn'],
  ['app/lib/alert.ts', 58, 'console.error(`[reservations] ${message}`);'],
  ['app/lib/alert.ts', 63, 'Twilio-dark ⇒ the log line above is the whole alert'],
  ['app/lib/alert.ts', 65, 'money alert reached NO admin (none reachable)'],
  // The only test of an unmatched BOOKING charge, and what it asserts about the body.
  ['src/reservations/booking-webhook.test.ts', 184, 'refuses a legacy eventId-shaped session: alerts, books nothing (#693)'],
  ['src/reservations/booking-webhook.test.ts', 196, 'toContain("REFUND MANUALLY")'],
  ['src/reservations/booking-webhook.test.ts', 200, 'toBeNull()'],

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
