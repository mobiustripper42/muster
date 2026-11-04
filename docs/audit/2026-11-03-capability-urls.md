# Audit: who can reach what in Muster without signing in

Read-only audit of branch `task/16.9-self-service-cancel` at `fd62b4f` (`main` plus pull request #1214), 2026-11-03. No code changed, no request sent to any deployed host. Every claim cites `path:line` on that branch. Four readers split the work (capability URLs, sign-in, admin actions, crew actions and route handlers); the lead re-read every file cited in a finding of S3 or above.

**Confidence levels.** `read` means the code was read and the claim follows from it. `suspected` means a test would settle it and none could run. **No finding is `tested`: `vitest` was denied by this session's permission policy on every attempt (four readers, the lead included).** Two scratch tests that would have raised confidence are reproduced in §6 for whoever can run them.

## 1. Summary

Doors checked: 8 capability URLs (`/b/<code>`, `/b/<code>/party`, `/b/<code>/calendar`, `/b/find`, `/p/<token>`, `/w/<code>`, `/api/calendar/<token>`, `/book/success`) plus the checkout holder cookie; 4 sign-in mechanisms (the 6-digit code door, the session cookie, the crew-to-admin switch, the dev-code echo); 73 exported server actions across 32 `"use server"` files (40 admin, 26 crew and sign-in, 7 public); and 11 route handlers. Every admin action, every crew action and every admin route handler checks the session cookie before any read or write, and every record id a crew member posts is checked against the caller, with one exception on a cosmetic mark (`/api/guest-contact`). Findings: **1 conditional S1** (the dev-code echo, open on any non-production deploy; S1 only if such a deploy ever shares the production database or `SESSION_SECRET`), **4 S2** (archived crew keep access; a cancelled booking's leaked code cannot be revoked; the rate limiter's only key is a header whose trust is a platform property and a null key means no limit; the 40-bit trip code rests on that limiter), **12 S3**, and **5 S4**. Nothing found lets a stranger act on another person's booking or money from the production configuration as the code describes it.

`grep -rl '"use server"' app` returns 34 files; two are false positives where the string appears in a comment (`app/(public)/book/checkout/never-rejects.ts:12`, `app/(public)/book/checkout/actions.test.ts`). Neither is an endpoint.

## 2. Findings, most severe first

### A1. The dev-code echo is open on any deploy where `VERCEL_ENV` is set and is not `production`

- **Expected.** DEC-174 (`docs/decisions/DEC-174-the-session-minters-are-deleted-one-door-in.md:5`): "Nothing mints a session out of band, in any environment." A reader expects no deploy reachable from the internet to hand out login codes.
- **Code.** `app/(crew)/crew/dev-code/route.ts:16-30`: unauthenticated `GET /crew/dev-code?email=<any>` returns the last plaintext code minted for that email in this process. The only gate is `isProdDeploy()` at `:19`, defined at `src/config/deploy.ts:31-36` as `VERCEL_ENV === "production"` or (`VERCEL_ENV` unset and `NODE_ENV === "production"`). So the route is live when `VERCEL_ENV` is `preview`, `development`, or any custom-environment value. The echo map is filled by `echoLoginCodeForDev` (`app/lib/auth-delivery.ts:59-63`) after the code's hash is stored in `login_codes` (`app/(crew)/crew/actions.ts:157-171`), so a code read from an open echo verifies against whichever database that deploy uses. The e2e harness opens the door deliberately with `VERCEL_ENV=preview` (`playwright.config.ts:231`).
- **Scenario.** A preview deploy is pointed at the production database (or carries the production `SESSION_SECRET`, so a cookie it mints works on production). Anyone posts the sign-in form with the operator's roster email, reads the code from `/crew/dev-code?email=…`, submits it, holds a crew session, and presses Switch to admin (`app/lib/switch-actions.ts:36-43`).
- **Mitigation that exists, all platform state.** DEC-173 (`docs/decisions/DEC-173-*.md:8,21,30`) says non-production branches are cancelled by a dashboard Ignored Build Step and that previews have no database since 2026-09-15. `vercel.json:5` only disables `main`. None of this is checkable from the repository.
- **Severity.** S1 if any internet-reachable non-production deploy shares the production database or signing secret; S3 as DEC-173 describes the deployment. **Confidence: read.**

### A2. An archived or disabled crew member can sign in afresh, and an existing crew session never re-checks their row

- **Expected.** `src/domain/entities.ts:99-101` says `archived` means "no longer with the operation … off every list"; `docs/DEPLOY.md:442` names `db:crew disable` as "Take someone out of rotation". A reader expects an off-boarded person to lose access.
- **Code.** The code door matches on email only: `matchCrewByEmail` (`src/auth/login-code.ts:87-97`) filters `listCrewMembers()` by email and never reads `status`; `verifyLoginCode` returns `{ ok: true, subject }` with no status check (`:294-344`). `readSubject` does its one stateful lookup only for `kind === "admin"` (`app/lib/auth.ts:94-102`); a crew subject is accepted on the HMAC alone, and the sliding renewal re-issues a fresh 14-day cookie whenever fewer than 3 days remain (`:19-20, 104-121`). The crew home falls to "session ended" only when the crew *row* is gone (`src/crewapp/crew-view.ts:162-163`), and neither CLI deletes rows (`src/crew/crew-cli.ts:300-331`; `docs/DEPLOY.md:451-455`). What an archived holder can still do: post in the all-staff thread, whose membership is the unfiltered roster (`src/messaging/membership.ts:66`); clock in and add or edit punches that reach payroll (`app/(crew)/crew/time/actions.ts:58-229`; no status check in `src/crew/time-clock.ts:61-85`); mint a calendar feed (`app/(crew)/crew/calendar/actions.ts:26-38`); start DMs (`app/(crew)/crew/threads/actions.ts:86-87` checks existence only). The one crew door that does check status is `claimSeat` (`src/asks/claim.ts:91`).
- **Scenario.** A deckhand is let go and archived. Their phone still opens the app for as long as they open it at least once every 14 days, and a month later they can also sign in again from scratch with their roster email. If they also held an `admins` row and the operator ran `db:crew archive` but not `db:admin revoke` (two separate steps, `docs/DEPLOY.md:250,442`), the switch to admin passes.
- **Severity.** S2 (a credential keeps working after it should stop). **Confidence: read.** The scratch test in §6.1 demonstrates the door half.

### A3. A cancelled booking's leaked code cannot be revoked and resolves forever

- **Expected.** SPEC §2.8.11 (`docs/SPEC.md:2164-2168`): "A reissue kills its predecessor." Reissue is the only revoke in the product (`revokeBookingCode` is called from `src/reservations/ensure-booking-code.ts:130` only, reached from `app/(admin)/admin/calendar/[reservationId]/actions.ts:805`). A reader expects the operator to be able to kill any live code.
- **Code.** `reissueBookingLink` refuses unless the reservation is booked (`app/(admin)/admin/calendar/[reservationId]/actions.ts:801`, `reissueErr: "cancelled"`). `loadBookingByCode` never checks reservation status (`app/b/[code]/load.ts:70-79`), and nothing mints an expiring code (`src/reservations/booking-code.ts:110-111`). The cancelled page renders name, trip, amounts, "Refunded", and the hosted Stripe receipt links (`app/b/[code]/page.tsx:144-146,316-331`), and still accepts `requestBookingChange` (`app/b/[code]/actions.ts:46-53`, no status check).
- **Scenario.** A customer cancels, then reports their phone stolen. The operator opens the pane to reissue and is told "cancelled". The thief's link keeps opening the receipt page indefinitely. The spec wants the page to stay open for the receipt (`docs/SPEC.md:2179-2181`); it does not say the operator should lose the revoke.
- **Severity.** S2. **Confidence: read.**

### A4. The rate limiter's only key is a forwarded header; a null or forged key means no limit, and the 40-bit trip code rests on it

- **Expected.** `docs/design/check-in-and-waivers.md:322-326`: the waiver page is rate-limited per client address (DEC-189). `src/checkin/trip-link.ts:10-13` then says "the length has to hold on its own", which an 8-character, 32-symbol code (`:25,48-53`, 32^8 ≈ 2^40) does not.
- **Code.** `app/lib/client-ip.ts:27-42`: the key is the first entry of `x-forwarded-for`; if it is not a Cloudflare address it is used as-is; if it is, `cf-connecting-ip` is believed verbatim; if either is unparseable the key is `null`. `src/rate-limit/rate-limit.ts:58`: a null key is "limited by nothing". Both public policies fail open (`trip-link.ts:32-37`, `src/checkin/signing.ts:33-38`). The limiter is used on exactly three paths: crew sign-in requests (`src/auth/login-code.ts:172`), `/w/<code>` opens (`trip-link.ts:183`) and `signWaiver` (`app/w/[code]/actions.ts:75`). `verifyLoginCode` has no per-address limit (`app/(crew)/crew/actions.ts:221-248`); it is bounded per subject instead (DEC-142, `login-code.ts:46,62-63`).
- **Where the key is attacker-chosen.** (i) If the platform appends to a client-sent `x-forwarded-for` rather than overwriting it, the first entry is the client's (`client-ip.ts:31`); the file asserts Vercel overwrites (`:10-13`), which is **unverified here**. (ii) If a request can arrive from a Cloudflare address with a client-set `CF-Connecting-IP` (Cloudflare-hosted compute, or a second Cloudflare zone pointed at the origin), the key is whatever that header says (`:36-41`); **unverified**. (iii) `X-Forwarded-For: nope` or a Cloudflare hop without `CF-Connecting-IP` yields `null` and no limit (`:33,37-40`). `CLOUDFLARE_RANGES` is hand-copied, dated 2026-09-30 (`app/lib/cloudflare-ips.ts:13`).
- **Scenario.** With the key nulled or chosen, the trip code is enumerable at line rate: at 10,000 guesses per second against 100 live departures the expected time to a first hit is about 13 days. A hit shows the departure's date and time, on a multi-booking departure every booker's surname and party size (`app/w/[code]/page.tsx:157-166`, `signing.ts:267-275`), and lets the holder sign names into any booked party (`signing.ts:118`).
- **Severity.** S2, conditional on the platform behaviour above; S3 if Vercel and Cloudflare behave as the file's comments say. **Confidence: read; platform behaviour unverified.** The scratch test in §6.2 pins the key under each header combination.

### A5. The crew session is a stateless bearer with no server-side revoke, and renews from the presented token

- **Expected.** A reader expects sign-out, or the operator, to be able to end a session. DEC-092 and `docs/DEPLOY.md:453-455` state the choice ("no per-crew session revoke"); this is recorded so the consequence is visible.
- **Code.** `endSession` deletes the browser's cookie only (`app/lib/auth.ts:126-129`). A copied `muster_session` value verifies until `expiresAt` (`src/auth/session.ts:97-101`), and renewal re-issues from the presented token (`auth.ts:104-108`), so a stolen token used every 14 days renews indefinitely. The payload carries no issued-at or version (`session.ts:25-30`). Levers: `admins.active` for admin subjects only (`auth.ts:99-102`), or rotating `SESSION_SECRET`, which signs out everyone (`docs/DEPLOY.md:447`).
- **Severity.** S3 (decided and documented; A2 is the half that is not). **Confidence: read.**

### A6. The 72-hour pay link shows the full phone and email, cannot be revoked, and several can be live

- **Expected.** `src/reservations/pay-by-link.ts:92-94` (`maskedPhone`): "enough to recognise your own number, not enough to hand a stranger holding a forwarded link the whole thing." SPEC §2.10.6 (`docs/SPEC.md:2752-2753`) says the page shows "who it is booked for" and is silent on how much.
- **Code.** In the payable state the form receives `name`, `phone`, `phoneLabel` and `email` in full (`app/(public)/p/[token]/page.tsx:113,164-169`); only the paid state masks (`:276`). The link is stateless and re-minted per send, so several can be live and none can be revoked (`src/reservations/payment-link.ts:5-9`). The holder can cancel the unpaid booking (`app/(public)/p/[token]/actions.ts:77-121`), which is intended.
- **Scenario.** The customer forwards the link to a friend to pay. The friend now holds the booker's full phone and email for 72 hours.
- **Severity.** S3. **Confidence: read.**

### A7. `/b/find` has no per-client limit; its only throttle is 15 minutes per typed contact, claimed before the match

- **Expected.** A public form that triggers a transaction, a full-table scan and an outbound SMS and email per submission should be bounded per client.
- **Code.** `src/reservations/recover-booking-link.ts:48,113-123`: `claimRecoverySend` is keyed on the submitted contact and claimed before matching. `app/b/find/actions.ts:40-83`: the work runs in `after()`; the scan is `listAllReservations()` plus `listEvents()` (`:62-65`); `takeRateLimit` is never called on this path. The file says so (`:17-19`). Every attempt writes a trail row, including `throttled` (`recover-booking-link.ts:120-123`).
- **Scenario.** One client cycles 10,000 phone numbers with a common surname: 10,000 transactions and scans, and for every real match an SMS the operator pays for, carrying the real customer's live link. Separately, submitting a victim's phone every 14 minutes stops them from ever recovering their own link (acknowledged at `:43-46`). No disclosure: the response and timing are identical (`actions.ts:85-86`) and the link goes to the contact on file.
- **Severity.** S3. **Confidence: read.**

### A8. Every change or cancel request emails the customer's live booking code to the operator inbox

- **Expected.** SPEC §2.8.11 (`docs/SPEC.md:2183-2185`): the operator's copy of the link "renders only on the single screen immediately following a reissue". `app/lib/manage-link.ts:31-33` calls a link sitting on screen for every booking "the exposure worth caring about".
- **Code.** `app/b/[code]/actions.ts:71-73` builds `manageUrl: bookingUrl(base, code)`; `src/reservations/booking-change-request.ts:54` prints it in the body sent to `OPERATOR_NOTIFY_EMAIL`. The two cancel-done emails correctly send the admin pane URL instead (`actions.ts:174`; `app/(public)/p/[token]/actions.ts:147`).
- **Scenario.** The operator's mailbox, and any forwarding rule or shared inbox, becomes a durable store of live credentials that can each cancel and trigger a refund (`app/b/[code]/actions.ts:119-154`). A mailbox compromise is the second mistake.
- **Severity.** S3. **Confidence: read.**

### A9. When Twilio is unconfigured, the log fallback redacts `/b/<code>` but not `/p/<token>` or `/w/<code>`

- **Expected.** `src/adapters/log-channel.ts:62-83` argues that a customer credential must not reach the production log stream; `app/lib/sms.ts:24-28` sets `revealBookingCodes: !prod`.
- **Code.** `redactBookingCodes` matches only `/b/` followed by 14 alphabet characters (`log-channel.ts:84-90`). The payment-link text (`src/reservations/send-payment-link.ts:38-43`) and the confirmation's "Sign yours" trip link (`src/reservations/booking-confirmation.ts:68-70`) pass through `LogChannel.send` untouched (`:135,141`). `makeSmsChannel` returns the log channel whenever Twilio is unconfigured (`app/lib/sms.ts:105-112`), and every send site uses it (`app/lib/payment-link.ts:49`, `app/lib/booking-confirmation.ts:74`, `app/b/find/actions.ts:48`).
- **Scenario.** A production deploy with Twilio dark writes every payment link, a 72-hour bearer that pays, cancels and shows full contact details (A6), to `console.error`, where whatever ingests the host's logs keeps it. Whether production is Twilio-dark is environment, not code.
- **Severity.** S3. **Confidence: read.**

### A10. No `noindex` on `/b/<code>`, `/p/<token>` or `/book/success`; no `robots.txt`; no security headers at all

- **Expected.** A page whose URL is the credential should ask not to be indexed, and a careful reader expects a `Referrer-Policy` and frame protection on pages that carry secrets and money.
- **Code.** `app/b/[code]/page.tsx` and `app/(public)/p/[token]/page.tsx` export no `metadata`; `app/layout.tsx:66-80` sets no `robots`; `public/` has no `robots.txt`; `next.config.ts` sets no `headers()`; `vercel.json` sets none; there is no `middleware.ts` or `proxy.ts`. Only `app/b/[code]/party/page.tsx:37-40` and `app/w/[code]/page.tsx:39-42` declare `robots: { index: false, follow: false }`, and each says "is not indexed" as if it were the rule. External links on the manage page carry `rel="noopener noreferrer"` (`app/b/[code]/page.tsx:241,323`); fonts are local (`app/layout.tsx:24-42`); `public/sw.js:8-12` caches nothing. `/p/<token>` loads `js.stripe.com` and the Payment Element iframe (`app/(public)/book/checkout/checkout-form.tsx:103-112`); whether the full path reaches Stripe in the `Referer` depends on the browser's default policy, **unverified**.
- **Scenario.** A manage link pasted into a public document or an unfurling chat is crawled and the page (name, trip, amounts, receipt links) is indexed under a credential that never expires.
- **Severity.** S3. **Confidence: read.**

### A11. Three paths put another person's data, or another person's writes, on a customer page

- **Known case, issue #1213.** `src/customers/resolve.ts:50-58` assigns `customerId` from the canonical phone alone, with no verification; `app/b/[code]/load.ts:127-144` lists every reservation sharing that `customerId`. Mitigation in place: rows only, never links (`load.ts:120-125`, DEC-198), and `e2e/book-manage.spec.ts:212-219` asserts the other code is absent. What a stranger who typed your phone still sees: the dates, times and booked/cancelled status of your trips (`app/b/[code]/page.tsx:391-409`). No other `customerId`, phone or email keyed read exists in the customer surfaces (`grep` over `app/b`, `app/w`, `app/(public)`, `src/checkin`, `src/reservations/{manage-view,find-booking,recover-booking-link,pay-by-link}.ts`).
- **The waiver link is keyed by departure, not booking.** `app/b/[code]/page.tsx:429` and `app/b/[code]/party/page.tsx:144` mint `/w/<tripCode>` for the departure for whoever holds any booking's code on it. On a multi-booking departure that page lists every booker's surname and party size (`app/w/[code]/page.tsx:157-166`; `src/checkin/signing.ts:267-275`) and lets the holder sign names into any still-booked party (`signing.ts:118,320-327`). Those names appear on the other booker's `/b/<code>/party` and raise their "N of M signed" (`src/checkin/party.ts:36-48`), the number the booker relies on to stop chasing (`docs/design/check-in-and-waivers.md:183-189`). The design accepts "junk signatures" as the token's threat (`:322-324`); the code is never revoked (DEC-190, `src/checkin/trip-link.ts:6-8`). The operator runs private charters, so this renders rarely, but the path exists.
- **Unverified contacts receive credentials, and recovery re-sends to both.** The reservation's phone and email are whatever was typed at checkout (`app/(public)/book/checkout/actions.ts:172-179,221-237`); nothing verifies either. The confirmation carries the live code and the trip link to both (`src/reservations/booking-confirmation.ts:105-131`); `resendBookingLink` always tries email and SMS (`src/reservations/resend-booking-link.ts:88-89`), so a `/b/find` match on the email also re-texts the phone on file; reminders text `/b/<code>/party` to the phone (`src/checkin/reminders.ts:140-151`). A booker who mistypes one digit sends a stranger a link that can cancel the trip (the refund goes to the original card).
- **Severity.** S3 for each. **Confidence: read.**

### A12. `/api/guest-contact` lets any signed-in subject stamp or erase the "Texted by" mark on any reservation

- **Expected.** A crew member can only mark guests on a shift they crew.
- **Code.** `app/api/guest-contact/route.ts:21-22` gates on any session; `:34-36` takes `reservationId` and `shiftId` from the body with no check that the caller holds a seat on that shift; the write upserts on `reservation_id` and overwrites `shift_id` (`src/adapters/postgres-repository.ts:2483-2491`). The docstring concedes it (`:15-18`). No rate limit. Not CSRF-exposed in practice: the cookie is `SameSite=Lax` (`app/lib/auth.ts:53`) and a cross-site form post is not JSON, so `:26` rejects it.
- **Scenario.** Crew A posts `{reservationId: <party on shift 2>, shiftId: "x"}` and shift 2's manifest loses its real mark; or marks a party as texted that nobody texted.
- **Severity.** S3. **Confidence: read.**

### A13. The balance-checkout URL round-trips through the query string and is rendered unvalidated in the admin pane

- **Expected.** The Stripe URL the operator is told to send came from `createBalanceCheckout`, not from the address bar.
- **Code.** `app/(admin)/admin/calendar/[reservationId]/actions.ts:152` redirects with `balanceUrl: result.url`; `page.tsx:422` passes `sp.balanceUrl` straight through; `reservation-detail-pane.tsx:736-753` renders whatever string is there under "Balance link for $X — send it to the customer" with a Copy button. `actions.ts:148` calls the URL "a bearer capability for a charge" and keeps it out of the trail, then `:152` puts it in the `Location` header, so it lands in browser history and any host log that keeps query strings.
- **Scenario.** Someone emails the operator `/admin/calendar/<id>?balanceUrl=https://evil.example/pay` for a booking with a balance owed. The trusted pane presents the attacker's URL with a Copy button.
- **Severity.** S3 (needs the operator to open an untrusted link and copy without reading). **Confidence: read.**

### A14. `SESSION_SECRET` has no minimum length, falls back to a repo-public string on `NODE_ENV`, and also signs pay links

- **Code.** `app/lib/auth.ts:28-35`: any non-empty value is accepted in production; when unset and `NODE_ENV !== "production"` the secret is `"dev-insecure-session-secret"`, and cookies are not `Secure` (`:54`; `app/lib/login-cookie.ts:16`). Any deploy run without `NODE_ENV=production` and without the variable yields forgeable sessions for any subject. The same secret signs the pay link, prefixed `pay-link:v2:` so the two cannot be swapped (`src/reservations/payment-link.ts:40,48`; `app/lib/auth.ts:37-41`). `docs/DEPLOY.md:40,152` recommend 32 random bytes; nothing enforces it.
- **Severity.** S3. **Confidence: read.** §6.3 pins the one-character case.

### A15. `/api/health` opens a fresh database connection per anonymous request

- **Code.** `app/api/health/route.ts:36-41`: a new `pg.Pool` with a 2-second timeout, ended in `finally`. It reveals only `status`, two state enums and `db.reachable` (`:42-46,54-58`). No limiter.
- **Severity.** S3 (a connection-amplification knob another layer would have to cover). **Confidence: read.**

### A16. `CRON_SECRET` is compared with `!==`

- **Code.** `app/api/cron/tick/route.ts:39-42`, `doorbell-tick/route.ts:36-39`, `xola-pull/route.ts:31-34`. Fail-closed when unset (401). With the secret a caller can form shifts, send waiver reminders and SMS asks, and read Stripe (`tick/route.ts:139-166`); `xola-pull` rewrites reservations and is not scheduled (`vercel.json:7-9`). Whether the platform sends the bearer on cron calls is **unverified**.
- **Severity.** S3. **Confidence: suspected** (a remote timing attack on a bearer through platform jitter is impractical).

### A17. `/b/<code>?error=__proto__` throws during render

- **Code.** `app/b/[code]/page.tsx:40` declares `ERROR_COPY` as an object literal; `:194-196` renders `ERROR_COPY[sp.error]`. `ERROR_COPY["__proto__"]` is `Object.prototype`, which React refuses as a child. `src/adapters/stripe-payment.ts:359-362` uses `Object.hasOwn` for this reason.
- **Severity.** S4 (one page errors for whoever opens that link). **Confidence: suspected**; test in §6.4.

### A18. `/book/success` is an unauthenticated, unlimited Stripe read with a one-bit oracle

- **Code.** `app/(public)/book/success/page.tsx:73-78` calls `confirmBookingByPaymentIntent`, which retrieves the intent from Stripe on every GET (`src/adapters/stripe-payment.ts:331-334`); no limiter. The sold-out card renders only for `lost` (`:83`); everything else is the same generic card with no booking data. Confirm is idempotent (`src/reservations/booking-webhook.ts:98,1112`).
- **Severity.** S4. **Confidence: read.**

### A19. `gusto.csv` answers the feature flag before the session check

- **Code.** `app/(admin)/admin/payroll/gusto.csv/route.ts:26-32`: 404 when `TIME_CLOCK` is off, 403 when on, so an anonymous caller learns the flag. The time-clock actions redirect identically on both branches (`app/(admin)/admin/time-clock/actions.ts:95,149,191`).
- **Severity.** S4. **Confidence: read.**

### A20. Docs and comments that are stale or silent

- `src/auth/session.ts:1-2,115-118` and `app/lib/auth.ts:11-17` still describe a magic link; DEC-173 claims `app/(crew)/crew/dev-link/route.ts` (`docs/decisions/DEC-173-*.md:17`), which DEC-174 deleted.
- SPEC §2.8.11 (`docs/SPEC.md:2183`) says "The code never travels in the address bar"; the code is the path of every customer page and of every post-action redirect (`src/reservations/booking-code.ts:93-95`; `src/reservations/customer-cancel.ts:38-41`).
- SPEC §3.2 (`docs/SPEC.md:2898-2913`) covers crew and admin only; nothing states the customer bearers' indexing posture, referrer policy, or that a cancelled booking's code is unrevokable (A3).
- `src/checkin/trip-link.ts:10-13` contradicts itself on whether the length holds alone (A4).
- `app/(public)/p/[token]/page.tsx:114` builds Stripe's return URL from `process.env.APP_BASE_URL || "http://localhost:3000"` instead of `appBaseUrl()`.
- `app/(admin)/admin/shifts/actions.ts:29,74,92,161`: `back` is free text appended after a fixed same-origin path, contrary to the docstring's "code only" (`:18-20`); `app/(crew)/crew/shift/[shiftId]/actions.ts:128-130` interpolates `shiftId` unencoded where `:34` encodes. Neither is an open redirect.
- `app/w/[code]/actions.ts:62-66`: the no-JS add-child branch writes a 60-second, path-scoped draft cookie before the limiter runs.
- **Severity.** S4. **Confidence: read.**

**Checked and sound.** Session HMAC is SHA-256 with a constant-time, length-guarded compare (`src/auth/session.ts:65-71`); payload is `{subjectKind, subjectId, expiresAt}` (`:25-30`); cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production (`app/lib/auth.ts:51-57`). The admin switch re-checks `admins.active` and mints a new token (`app/lib/switch-actions.ts:36-43`); every admin request re-checks the row (`auth.ts:99-102`). The code is `crypto.randomInt`, stored as SHA-256, 10-minute TTL, 5 attempts per code claimed atomically before evaluation, 50 failures per subject per 24 hours, consumed by compare-and-swap, one failure value for every outcome (`src/auth/login-code.ts:39-65,73-75,315-343`). The booking code is 70 bits from `randomBytes` with a bias-free alphabet (`src/reservations/booking-code.ts:54-61`); the pay link is a 128-bit HMAC tag verified in constant time with canonical-spelling checks (`src/reservations/payment-link.ts:76-103`); the feed token is 256 bits stored hashed (`src/auth/secret.ts:13-24`). The 16.9 cancel action reads only `code`, `quotedCents` and `expectedRefunded`; the reservation id comes from the code's own row and the core re-reads and compare-and-swaps the quote (`app/b/[code]/actions.ts:119-143`; `src/reservations/customer-cancel.ts:123-148`). The Stripe webhook verifies the signature before parsing and is idempotent on the intent id (`src/adapters/stripe-payment.ts:426-434`; `src/reservations/booking-webhook.ts:203,851-870`). Check-in cannot reach another departure's guest (`src/adapters/postgres-repository.ts:2977-2984`; `src/checkin/check-in.ts:164-166`). No action takes a crew id and acts as that crew.

## 3. Every capability URL

| Route | Holding it grants | Minted (entropy) | Lifetime, revocation | Lookup rate limit |
|---|---|---|---|---|
| `/b/<code>` (`app/b/[code]/page.tsx`) | See customer name, trip date/time/duration/location, guest count, crew count, fare/tax/tip/insurance/paid/balance/refunded, Stripe receipt links, dates/times/status of the same phone's other bookings (A11). Do: request change or cancel (emails operator), cancel with refund when terms owe (`app/b/[code]/actions.ts:119-154`), download `.ics`, open party page, obtain the departure's `/w/` link (`page.tsx:429`) | `mintBookingCode`: `randomBytes(14)`, `& 31`, 14 chars of Crockford base32, 70 bits (`src/reservations/booking-code.ts:54-61`) | No expiry (`booking-code.ts:110-111`). Survives cancel and the trip. Revoked only by admin reissue, only while booked (A3). Reissue mints first then revokes all priors (`src/reservations/ensure-booking-code.ts:102-147`); old code shows "replaced" (`app/b/[code]/load.ts:72-73`) | None. One primary-key read per unknown code (`load.ts:70`); about ten reads including two full-table lists per hit (`:83-95`) |
| `/b/<code>/party` | Every signed name on the booking, minors' ages, coverage count, the trip link to share | same code | same; names persist after the trip | none |
| `/b/<code>/calendar` | `.ics` with title, date/time, duration, location; filename carries the reservation id | same code | same; 404 on refused | none |
| `/b/find` (no secret) | Triggers SMS and email of the live code to the contact on file; identical response always | n/a | 15 minutes per contact key, claimed before the match (`src/reservations/recover-booking-link.ts:48,113-123`) | No per-client limit (A7) |
| `/p/<id>.<exp>.<sig>` (`app/(public)/p/[token]`) | See offering, location, date/time, guests, full name, full phone, full email (A6), frozen invoice. Do: create a PaymentIntent and pay; cancel the unpaid booking (`actions.ts:49-69,77-121`) | HMAC-SHA256 over `pay-link:v2:<id>:<exp>` with `SESSION_SECRET`, first 16 bytes, 128-bit tag (`src/reservations/payment-link.ts:46-61`); id and expiry are public structure | 72 hours from each mint (`:38`); stateless, no revoke, several can be live (`:9`); paid or cancelled rows render a terminal card and never lead to `/b/` | None (constant-time verify, cheap) |
| `/w/<code>` (`app/w/[code]`) | See departure date/time; on multi-booking departures every booker's surname and party size; a signer's first name via `?signed=`. Do: sign the waiver (adult plus up to 10 minors; name, DOB, email, phone, IP, user agent stored) into any booked party or as walk-up | `mintTripCode`: `randomBytes(8)`, 8 chars, 40 bits (`src/checkin/trip-link.ts:48-53`) | Until the end of the trip's day, boat time (`:154-172`); never revoked (DEC-190); minted on demand by any booking's manage or party page, the confirmation, and the crew QR | 120 opens per minute per address, 20 signs per minute per address (`trip-link.ts:32-37`; `src/checkin/signing.ts:33-38`); key per A4; fail-open |
| `/api/calendar/<token>[.ics]` | The crew member's confirmed shifts: vessel, role, call and end instants, dock, co-crew first names, their own name | `randomSecret()`: `randomBytes(32)` base64url, 256 bits; SHA-256 stored (`src/auth/secret.ts:13-24`) | Until regenerated or revoked by the owner (`app/(crew)/crew/calendar/actions.ts:26-51`); one row per crew member; 404 on miss, identical for wrong, missing and revoked (`app/api/calendar/[token]/route.ts:21-42`) | None |
| `/book/success?payment_intent=pi_…` | Triggers the idempotent confirm; generic success or sold-out card (A18) | Stripe's id | n/a | None |
| Checkout holder token (cookie, not a URL) | Reuse of one's own pending hold on retry | `randomBytes(32)` base64url, 256 bits (`src/reservations/holder-token.ts:30-32`) | 30-minute cookie (`app/(public)/book/checkout/actions.ts:130`) | n/a |

The dev seeds mint a deliberately guessable demo code (`src/reservations/seed-reservation.ts:313-329`); its callers are `db/seed-*-dev.ts` and e2e only. The guard that keeps it out of a real database was not read.

## 4. Every server action and route handler

Format: `file:line` — function — who may call it — where that is checked. "admin" means `readSubject()` returned a subject of kind `admin`, which implies the `admins` row is active (`app/lib/auth.ts:99-102`). "crew" means kind `crew`. There is no `requireAdmin` helper; every site inlines `readSubject()` and the kind test, and in every site below the check is the first awaited statement and sits outside any `try`.

### Admin (`app/(admin)/admin/`)

- `actions.ts:17` setEnginePaused — admin — `:18-19`
- `add-ons/actions.ts:35` saveAddOn — admin — `:36-37`; tenant forced at `:50`
- `at-risk/actions.ts:21` leanOn — admin — `:22-25`
- `blocks/actions.ts:30` saveBlock — admin — `:31-32`
- `blocks/actions.ts:93` liftBlock — admin — `:94-95`
- `calendar/[reservationId]/actions.ts:91` createBalanceLink — admin — `:92-93` (A13)
- `…/actions.ts:182` cancelPhoneBooking — admin — `:183-184`
- `…/actions.ts:231` sendPaymentLinkAgain — admin — `:232-233`; recipient from the row `:239-242`
- `…/actions.ts:266` cancelBooking — admin — `:267-268`; refund CAS and lease in `src/reservations/refund-payment.ts:153-168`
- `…/actions.ts:535` startRefund — admin — `:536-537`; writes nothing
- `…/actions.ts:565` refundBooking — admin — `:566-567`; domain refuses non-positive, over-ask, stale (`refund-payment.ts:128-168`)
- `…/actions.ts:678` resendConfirmation — admin — `:679-680`; recipient from the row `:691-698`
- `…/actions.ts:785` reissueBookingLink — admin — `:786-787`; revokes then sends to the row's contact `:799-816`
- `calendar/actions.ts:52` holdSlot — admin — `:53-54`
- `calendar/actions.ts:94` releaseHold — admin — `:95-96`
- `calendar/book-actions.ts:36` bookPhoneReservation — admin — `:37-38`; sends to the contact the operator typed (the feature)
- `import/actions.ts:33` pullFromXola — admin — `:34-35`
- `locations/actions.ts:24` saveLocation — admin — `:25-26`
- `messages/actions.ts:29` postOperatorMessage — admin, `MESSAGING` on — `:30-32`; `threadId` constrained by `operatorStandingTarget` (`:44-45`)
- `offerings/actions.ts:65` saveOffering — admin — `:66-67`; tenant forced `:130`
- `shift/[shiftId]/actions.ts:132` assignTo — admin via `gate()` `:64-66` — `:133`
- `…:158` nudgeOn — admin — `:159`
- `…:181` confirmInto — admin — `:182`
- `…:197` overrideTo — admin — `:198`; role floor in domain `:204-206`
- `…:256` removeSeat — admin — `:257`; occupant from the seat row `:271`
- `…:310` reportBail — admin — `:311`; bailer from the seat row `:325`
- `…:364` addManningSeat — anyone — none; body is only `redirect` (`:365`)
- `…:369` removeManningSeat — anyone — none; body is only `redirect` (`:370`)
- `…:380` staffTrainee — admin — `:381`
- `…:428` unstaffTrainee — admin — `:429`
- `shifts/actions.ts:25` splitAction — admin — `:26,30`
- `shifts/actions.ts:89` mergeAction — admin — `:90,93`
- `time-clock/actions.ts:94` addPunchAction — admin, `TIME_CLOCK` on — `:95-96` via `requireAdmin` `:63-66`
- `…:148` editPunchAction — admin — `:149-150`
- `…:190` deletePunchAction — admin — `:191-192`
- `time-off/actions.ts:28` adminAddTimeOff — admin — `:29-30`
- `time-off/actions.ts:59` adminRemoveTimeOff — admin — `:60-61`
- `vessels/actions.ts:27` saveVessel — admin — `:28-29`
- `waivers/actions.ts:35` saveWaiverVersion — admin — `:36-37`
- `waivers/actions.ts:73` saveSettings — admin — `:74-75`
- `payroll/tips.csv/route.ts:14` GET — admin — `:15-18` (403 otherwise); `period` regex-validated `:19-22`
- `payroll/gusto.csv/route.ts:25` GET — admin, `TIME_CLOCK` on — `:29-32`; flag answered first `:26-28` (A19)

### Crew and sign-in (`app/(crew)/crew/`, `app/lib/switch-actions.ts`)

- `actions.ts:47` respondToAsk — crew — `:48-49`; `ask.crewMemberId === subject.id` `:59`
- `actions.ts:84` signOut — anyone — none needed; clears own cookie
- `actions.ts:99` requestLoginCode — anyone — per-address limiter inside `src/auth/login-code.ts:172-181` (A4)
- `actions.ts:221` verifyLoginCode — anyone holding the `muster_login_email` cookie — per-subject claim `login-code.ts:316-331`; no per-address limit
- `app/lib/switch-actions.ts:21` switchToCrew — admin — `:22-23`
- `app/lib/switch-actions.ts:36` switchToAdmin — crew whose id has an active `admins` row — `:37-40`
- `app/lib/switch-actions.ts:57` signOutAdmin — anyone — none needed
- `calendar/actions.ts:26` mintCalendarFeed — crew — `:27-28`; writes for `subject.id` only; no status check (A2)
- `calendar/actions.ts:40` hideCalendarUrl — anyone — none; deletes own flash cookie only `:57-59`
- `calendar/actions.ts:45` revokeCalendarFeed — crew — `:46-47`; deletes own feed only
- `open/actions.ts:25` claimSeat — crew — `:26,30`; core re-checks predicate, `status === active` and CAS (`src/asks/claim.ts:90-111,174`)
- `shift/[shiftId]/actions.ts:27` bailFromSeat — crew — `:28-33`; seat must be Confirmed and assigned to the caller `:40-46`
- `shift/[shiftId]/actions.ts:95` dismissShiftChanges — crew — `:97-98`; writes only rows for (shift, caller) `:109-121`
- `shift/[shiftId]/check-in/[eventId]/actions.ts:34` tickGuest — crew — `:40-41`; Confirmed seat on the shift and event on the shift (`src/checkin/check-in.ts:129-139`); guest must belong to the event (adapter)
- `…/actions.ts:58` tickGuestForm — crew — via tickGuest `:61`
- `…/actions.ts:66` confirmCount — crew — `:70-71`; same gate (`check-in.ts:178-180`)
- `threads/actions.ts:27` postMessage — crew, `MESSAGING` on — `:28-30`; `threadMembership` (`src/crewapp/thread-list.ts:322-337`)
- `threads/actions.ts:77` startDm — crew, `MESSAGING` on — `:78-80`; target existence only `:86-87`
- `time-off/actions.ts:30` addMyTimeOff — crew — `:31-32`; id from session
- `time-off/actions.ts:59` removeMyTimeOff — crew — `:60-61`; `ownsTimeOff` (`src/crew/time-off.ts:68-75`)
- `time-off/actions.ts:89` setMyDaysOff — crew — `:90-91`
- `time/actions.ts:58` clockInNow — crew, `TIME_CLOCK` on — `:59-61`
- `time/actions.ts:87` clockOutNow — crew — `:88-90`; closes own open punch
- `time/actions.ts:138` editMyPunch — crew — `:139-141`; `ownPunch` (`src/crew/time-clock-crew.ts:52-60,103`)
- `time/actions.ts:186` addMyPunch — crew — `:187-189`; `origin: "crew"`
- `time/actions.ts:226` deleteMyPunch — crew — `:227-229`; `ownPunch` `:197-198`

### Public (`app/b/`, `app/w/`, `app/(public)/`)

- `app/b/[code]/actions.ts:46` requestBookingChange — anyone with a live booking code — `loadBookingByCode` `:51-53`; no status check (A3)
- `app/b/[code]/actions.ts:119` cancelFromManagePage — anyone with a live booking code — `:121-123`; reservation id from the code's row `:141`; Stripe env gate `:127-129`; core re-reads and CAS (`src/reservations/customer-cancel.ts:123-148`)
- `app/b/find/actions.ts:33` requestBookingLink — anyone — no auth; per-contact throttle inside `after()` (A7); fixed redirect `:86`
- `app/w/[code]/actions.ts:46` signWaiver — anyone with a trip code — limiter `:75-79`; trip open `:83-85`; party must be booked on the event (`src/checkin/signing.ts:118`); no-JS child edit precedes the limiter `:62-66`
- `app/(public)/p/[token]/actions.ts:49` startPaymentLinkCheckout — anyone with a valid, unexpired token — `checkPaymentLink` `:58`; core requires operator-booked, pending, due > 0 (`src/reservations/pay-by-link.ts:28-38`)
- `app/(public)/p/[token]/actions.ts:77` cancelFromPaymentLink — same — `:82-84`; core refuses non-operator or booked rows (`src/reservations/cancel-reservation.ts:164-170`)
- `app/(public)/book/checkout/actions.ts:147` startElementsCheckout — anyone — Stripe env `:152-156`; name, terms and phone gates `:158-179`; holder cookie minted `:114-145`

### Route handlers

- `app/api/calendar/[token]/route.ts:25` GET — holder of a crew feed token — hash lookup `:34-38`; wrong, missing and revoked all 404 identically; the only write for a valid token is the poll stamp `:52-54`
- `app/api/cron/tick/route.ts` GET — `Authorization: Bearer CRON_SECRET` — `:39-42`; 401 when unset (A16)
- `app/api/cron/doorbell-tick/route.ts` GET — same — `:36-39`
- `app/api/cron/xola-pull/route.ts` GET — same — `:31-34`; not scheduled in `vercel.json`
- `app/api/guest-contact/route.ts:20` POST — any signed-in subject — `:21-22`; no shift scoping (A12)
- `app/api/health/route.ts` GET — anyone — none by design (A15)
- `app/api/webhooks/stripe/route.ts` POST — holder of `STRIPE_WEBHOOK_SECRET` — header `:33-35`, verified in `src/adapters/stripe-payment.ts:426-434` before parsing; 500 "not configured" when unset `:37-42`; unsigned posts get 400 `:55-58`
- `app/b/[code]/calendar/route.ts:17` GET — holder of a live booking code — `loadBookingByCode` `:22-23`; unknown and refused both 404
- `app/(crew)/crew/activity/route.ts:16` POST — crew (others 204, no-op) — `:17-18`; read mark gated by `threadMembership` `:40-49`
- `app/(crew)/crew/dev-code/route.ts:16` GET — anyone — no auth; `isProdDeploy()` 404 only (A1)
- `app/(admin)/admin/payroll/{gusto,tips}.csv/route.ts` GET — listed under Admin above

Layouts are not gates and do not run for server-action posts or route handlers: `app/(admin)/admin/layout.tsx:11-13,28` reads the subject only to decide whether to draw the nav; `app/(crew)/layout.tsx:12-19` mounts a beacon. `app/(admin)/admin/page.tsx:25-26`, both `[...slug]` catch-alls and `app/page.tsx:14-20` only redirect. `app/(crew)/crew/help/page.tsx` is public by design (`:8-10`).

## 5. Could not be determined from the code

1. **Platform header handling.** Whether Vercel overwrites or appends a client-sent `x-forwarded-for`; whether `*.vercel.app` or the origin is reachable in production without Cloudflare; whether Cloudflare strips a client-sent `CF-Connecting-IP`; whether Cloudflare-hosted compute egresses inside `cloudflare.com/ips` with a settable `CF-Connecting-IP`. A4 turns on these.
2. **Deploy state.** Whether the dashboard Ignored Build Step (DEC-173) is on; what `VERCEL_ENV` holds for custom environments; which `DATABASE_URL`, `SESSION_SECRET` and `RESEND_API_KEY` any non-production deploy carries. A1 turns on these.
3. **Secrets as deployed.** The length of the production `SESSION_SECRET` (A14); whether Twilio is configured in production (A9); whether the platform sends the cron bearer (A16).
4. **Logs.** What the host's access log retains of paths (`/b/<code>`, `/p/<token>`, `/w/<code>`, `?payment_intent=`) and query strings (A13), and who reads the `console.error` stream (A9).
5. **Browser behaviour.** The default referrer policy applied to the Stripe script and iframe loads on `/p/<token>` (A10). Next.js's server-action Origin/Host check is framework behaviour, not read from this repository; `next.config.ts` sets no `allowedOrigins`.
6. **Test results.** Every `vitest` invocation was denied. The four tests below were written and not run.

## 6. Scratch tests, written and not run

Place each under `src/` (vitest's include) or beside the file it exercises, run `npx vitest run <file>`, delete. Expected outcomes are from reading the code.

### 6.1 A2, the door ignores status

```ts
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { issueLoginCode, requestLoginCode, verifyLoginCode } from "./login-code.js";

const at = (ms = 0) => new Date(Date.parse("2026-06-29T12:00:00Z") + ms);
async function repoWith(status: "inactive" | "archived") {
  const repo = new InMemoryRepository();
  await repo.saveCrewMember({
    id: asId<"CrewMemberId">("crew-gone"), name: "Gone", phone: "+15550009",
    email: "gone@bb.test", ratings: [asId<"RoleTypeId">("captain")], status, reliabilityScore: null,
  });
  return repo;
}
describe("A2: status is not consulted by the code door", () => {
  for (const status of ["inactive", "archived"] as const) {
    it(`${status} crew can request and verify`, async () => {
      const repo = await repoWith(status);
      const r = await requestLoginCode(repo, { email: "gone@bb.test" }, { now: at(), mintCode: () => "123456" });
      expect(r.outcome).toBe("issue");
      if (r.outcome !== "issue") return;
      expect(await issueLoginCode(repo, r.pending, { now: at() })).toBe("deliver");
      expect(await verifyLoginCode(repo, { email: "gone@bb.test", code: "123456" }, { now: at(1000) }))
        .toEqual({ ok: true, subject: { kind: "crew", id: "crew-gone" } });
    });
  }
});
```
Expected: both cases pass, which is the finding.

### 6.2 A4, the limiter key under each header combination

```ts
import { describe, expect, it } from "vitest";
import { clientIpFrom } from "../../app/lib/client-ip";
import { limitKeyFor } from "../rate-limit/rate-limit.js";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
const CF = "173.245.48.5";
describe("A4: who chooses the rate-limit key", () => {
  it("direct hop: a client CF-Connecting-IP is ignored", () =>
    expect(clientIpFrom(h({ "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "9.9.9.9" }))).toBe("203.0.113.9"));
  it("the FIRST x-forwarded-for entry is the key", () =>
    expect(clientIpFrom(h({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" }))).toBe("9.9.9.9"));
  it("Cloudflare hop: CF-Connecting-IP is believed verbatim", () =>
    expect(clientIpFrom(h({ "x-forwarded-for": CF, "cf-connecting-ip": "9.9.9.9" }))).toBe("9.9.9.9"));
  it("unparseable or missing address: null key, so no limit", () => {
    expect(limitKeyFor(clientIpFrom(h({ "x-forwarded-for": "nope" })))).toBeNull();
    expect(limitKeyFor(clientIpFrom(h({ "x-forwarded-for": CF })))).toBeNull();
    expect(limitKeyFor(clientIpFrom(h({})))).toBeNull();
  });
});
```
Expected: all pass. Whether a client can produce any of these header shapes at the origin is the unverified half.

### 6.3 A14, a one-character secret is accepted

```ts
import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./session.js";

const s = { subjectKind: "admin" as const, subjectId: "crew-x", expiresAt: "2026-07-13T12:00:00.000Z" };
const now = new Date("2026-06-29T12:00:00Z");
describe("A14", () => {
  it("1-char secret verifies", () => expect(verifySession(signSession(s, "1"), "1", now).ok).toBe(true));
  it("rotated secret kills old tokens", () =>
    expect(verifySession(signSession(s, "old"), "new", now)).toEqual({ ok: false, reason: "bad_signature" }));
});
```
Expected: both pass; the first is the finding, the second confirms rotation works.

### 6.4 A17, `?error=__proto__`

```ts
import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { Notice } from "../../../components/ui/notice";

const ERROR_COPY: Record<string, ReactNode> = { link: "…", cancel_failed: "…" }; // page.tsx:40 shape
const renderLike = (spError: string) => {
  const child = spError && ERROR_COPY[spError]; // page.tsx:194 shape
  return child ? renderToString(createElement(Notice, { tone: "bad" }, child)) : "";
};
describe("A17", () => {
  it("unknown key renders nothing", () => expect(renderLike("nope")).toBe(""));
  it("__proto__ resolves to Object.prototype and the render throws", () => {
    expect(ERROR_COPY["__proto__"]).toBe(Object.prototype);
    expect(() => renderLike("__proto__")).toThrow(/Objects are not valid as a React child/);
  });
});
```
Expected: both pass; the second is the finding.
