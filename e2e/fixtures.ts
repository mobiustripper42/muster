/**
 * e2e harness fixtures (#65) — the three things every spec needs: a deterministic
 * DB state, a signed-in crew session, a signed-in operator session.
 *
 * Seed strategy (DEC at task #65): the dev seeds are CLI scripts, not exported
 * functions. Rather than refactor three working scripts, we spawn them with
 * DATABASE_URL pointed at the test DB. Heavier than an in-process call, but the
 * scripts stay untouched and the harness reuses the exact states the manual
 * walkthrough (RUNNING.md) already documents.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { resetTestDb, TEST_DATABASE_URL } from "../db/reset-test.js";
import { serverOf, SLOW_PATH_FOR } from "./slow-path.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { pgConnectionConfig } from "../src/config/db-ssl.js";
import { takeRateLimit, type RateLimitPolicy } from "../src/rate-limit/rate-limit.js";
import { TODAY } from "./reservation-demo.js";

/** Local tsx binary — resolved explicitly so we don't depend on PATH/npx. */
const TSX = "node_modules/.bin/tsx";

const SEED_SCRIPTS = {
  crew: "db/seed-crewapp-dev.ts",
  atrisk: "db/seed-atrisk-dev.ts",
  reservation: "db/seed-reservation-dev.ts",
  xola: "db/seed-xola-dev.ts",
  concurrent: "db/seed-concurrent-dev.ts",
} as const;

type SeedName = keyof typeof SEED_SCRIPTS;

/**
 * The e2e operator: a seeded admin whose short handle is `eric` — what every
 * `signInAsAdmin(page, "eric")` resolves through the `getAdminByHandle` lookup
 * (DEC-092). Its id is the operator's crew id, `crew-eric-stoffer` — every admin is crew.
 * `resetTestDb` truncates `admins` (dynamic all-tables wipe), so we re-seed it on
 * every reset; the prod roster (the 0018 migration's eric/brendan/drew) is wiped
 * too, which is fine — e2e drives its own synthetic operator.
 */
async function seedAdmin(a: {
  id: string;
  handle: string;
  name?: string;
  active?: boolean;
}): Promise<void> {
  const active = a.active ?? true;
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    await repo.saveAdmin({
      id: a.id,
      handle: a.handle,
      name: a.name ?? a.handle,
      active,
      createdAt: "2026-07-06T00:00:00.000Z",
      deactivatedAt: active ? null : "2026-07-06T09:00:00.000Z",
    });
  } finally {
    await repo.close();
  }
}

/**
 * Seed an extra admin (e.g. a second operator for the per-person-revoke test) — AND the crew row
 * behind it, with an email, unless one is already seeded. An admin gets in the way everyone does:
 * the code door as crew, then Switch to admin (DEC-174), and the door needs an email on file —
 * the same reason `db:admin add --crew=` refuses a crew member without one.
 */
export async function seedExtraAdmin(
  a: { id: string; handle: string; name?: string; active?: boolean },
): Promise<void> {
  await seedCrewMember({ id: a.id, name: a.name ?? a.handle, email: `${a.handle}@bb.test` });
  await seedAdmin(a);
}

/** Seed a bare crew member — no ratings, seats or credentials — unless the id is already taken. */
export async function seedCrewMember(c: { id: string; name: string; email: string }): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    if ((await repo.listCrewMembers()).some((m) => String(m.id) === c.id)) return;
    await repo.saveCrewMember({
      id: c.id as never,
      name: c.name,
      email: c.email,
      phone: "+15555550199",
      ratings: [],
      status: "active",
      reliabilityScore: null,
    });
  } finally {
    await repo.close();
  }
}

/**
 * Plant a `pending` reservation on a slot (14.4, SPEC §2.8.2) — a customer who is at Stripe with
 * their card in hand. While it is live it commits the hull, so the slot must not be advertised.
 *
 * Replaces `plantCheckoutHold`, which planted a `checkout_holds` row until 14.7 dropped that
 * table. The thing under test is unchanged: whether `/book` SUBTRACTS a customer mid-payment.
 *
 * Written straight through the port rather than by driving the funnel, and with `saveReservation`
 * rather than `savePendingIfHullFree`, so a test controls exactly what lands — including a LAPSED
 * row, which is the half of the contract nothing else can reach. Liveness is `reservedAt` inside
 * the payment window (15 min), lazily compared at derive time with no cron behind it, so a row
 * that has aged out sits in the table forever and must read as free.
 *
 * `holdMinutes` is what the row commits the hull for (DEC-161) — 100 matches the demo offering's
 * trip length, so a row at 15:30 clears by 17:10 and leaves the 17:30 departure alone.
 */
export async function plantPendingReservation(r: {
  id: string;
  vesselId: string;
  date: string;
  time: string;
  offeringId: string;
  guestCount: number;
  /** ISO-8601 UTC. Inside the last 15 minutes ⇒ live; older ⇒ lapsed and inert. */
  reservedAt: string;
}): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    await repo.saveReservation({
      id: r.id as never,
      eventId: null,
      source: "muster",
      status: "pending",
      customerName: "E2E Pending",
      partySize: r.guestCount,
      vesselId: r.vesselId as never,
      date: r.date,
      time: r.time,
      offeringId: r.offeringId as never,
      reservedAt: r.reservedAt,
      holdMinutes: 100,
      tripMinutes: 100,
      updatedAt: r.reservedAt,
    });
  } finally {
    await repo.close();
  }
}

/**
 * Take a boat out of service over a date range (#715) — the only way to reach the availability
 * screen's "no boat here fits your party" state.
 *
 * The `reservation` seed attaches three boats at 12/14/16 and no blocks, so the offering's
 * largest hull runs every day of the season and a party is never bigger than everything on the
 * water — the stepper's ceiling IS that boat. Blocking the 16 for a few days is what makes those
 * days genuinely too small for a party of 15, and it plants the block rather than seeding one so
 * the seed's `/admin/blocks` demo keeps starting from an empty block list.
 */
export async function plantVesselBlock(b: {
  id: string;
  vesselId: string;
  startDate: string;
  endDate: string;
}): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    await repo.saveBlock({
      id: b.id as never,
      kind: "vessel",
      vesselId: b.vesselId as never,
      startDate: b.startDate,
      endDate: b.endDate,
    });
  } finally {
    await repo.close();
  }
}

/**
 * Put a crew shift on a booking's trip (issue #1079): `required` required seats, none filled. The
 * `reservation` seed books trips but forms no shifts, so this is the only way to reach the calendar
 * List's Crew column with real shift and seat rows behind it.
 */
export async function plantShiftForBooking(b: { reservationId: string; required: number }): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const r = await repo.getReservation(b.reservationId as never);
    const event = r?.eventId ? await repo.getEvent(r.eventId) : null;
    if (!event) throw new Error(`no trip behind ${b.reservationId}`);
    const shiftId = `shift-e2e-${b.reservationId}` as never;
    await repo.saveShift({ id: shiftId, vesselId: event.vesselId, date: event.date, state: "Filling", eventIds: [event.id] });
    for (let i = 0; i < b.required; i++) {
      await repo.saveSeat({
        id: `seat-e2e-${b.reservationId}-${i}` as never,
        shiftId,
        role: "role-captain" as never,
        kind: "required",
        state: "Open",
      });
    }
  } finally {
    await repo.close();
  }
}

/**
 * Use up a rate limit for one address (Phase 18.3a) — the same `takeRateLimit` the app calls, so
 * the window arithmetic cannot drift from production's. Pair with a request carrying that address
 * in `x-forwarded-for` (`page.setExtraHTTPHeaders`): local runs have no Vercel in front, so without
 * the header there is no address and nothing is limited.
 */
export async function exhaustRateLimit(policy: RateLimitPolicy, key: string): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    for (let i = 0; i < policy.limit; i++) {
      await takeRateLimit({ repo, now: () => new Date().toISOString() }, policy, key);
    }
  } finally {
    await repo.close();
  }
}

/**
 * Plant a departure with a trip link (Phase 18.3b) — one call per `/w/<code>` state. The event is a
 * Muster departure on the crew seed's `vessel-hops`; the link is inserted directly, as
 * `ensureTripLink` would, so the test controls the code.
 */
export async function plantTripLink(t: {
  code: string;
  date: string;
  time: string;
  status?: "scheduled" | "cancelled";
}): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const eventId = `evt-trip-${t.code}`;
    await repo.saveEvent({
      id: eventId as never,
      vesselId: "vessel-hops" as never,
      date: t.date,
      time: t.time,
      capacity: 16,
      status: t.status ?? "scheduled",
      source: "muster",
    });
    await repo.insertTripLink({ code: t.code, eventId: eventId as never, createdAt: new Date().toISOString() });
  } finally {
    await repo.close();
  }
}

/**
 * Plant a booked party on a departure (Phase 18.4) — the booking a signer joins, and the party size
 * the success screen counts against. Written through the port, like the other plants.
 */
export async function plantBookedReservation(r: {
  id: string;
  eventId: string;
  customerName: string;
  partySize: number;
  /** The booker's contacts — what a reminder (18.7) is sent to. */
  phone?: string;
  email?: string;
}): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    await repo.saveReservation({
      id: r.id as never,
      eventId: r.eventId as never,
      customerName: r.customerName,
      partySize: r.partySize,
      status: "booked",
      source: "muster",
      ...(r.phone ? { phone: r.phone } : {}),
      ...(r.email ? { email: r.email } : {}),
    });
  } finally {
    await repo.close();
  }
}

/** One booking's trail rows as the database holds them (18.7) — what a cron tick left behind. */
export async function readTrailFor(reservationId: string): Promise<{ type: string; reason?: string }[]> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    return (await repo.listTrailEventsFor(reservationId as never, [])).map((e) => ({
      type: e.type,
      ...(e.metadata.reason !== undefined ? { reason: e.metadata.reason } : {}),
    }));
  } finally {
    await repo.close();
  }
}

/**
 * Plant signed guests on a departure (Phase 18.5a) — the rows the mate's check-in list shows. An
 * adult is signed; a minor names its guardian and carries no signature, as a real signing writes
 * them. `checkedIn` plants a tick already made (by Quint), for the states a fresh list cannot reach,
 * like a boat one tick from full.
 */
export async function plantGuests(
  eventId: string,
  guests: { id: string; name: string; minorOf?: string; dob?: string; checkedIn?: boolean }[],
): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const at = "2026-10-01T18:00:00.000Z";
    await repo.saveGuests(
      // Guardians first: a minor's row points at theirs.
      [...guests]
        .sort((a, b) => Number(Boolean(a.minorOf)) - Number(Boolean(b.minorOf)))
        .map((g) => ({
          id: g.id as never,
          eventId: eventId as never,
          name: g.name,
          isMinor: Boolean(g.minorOf),
          ...(g.dob ? { dob: g.dob } : {}),
          ...(g.minorOf
            ? { guardianGuestId: g.minorOf as never }
            : { email: `${g.id}@example.com`, signedAt: at, signatureName: g.name }),
          ...(g.checkedIn ? { checkedIn: { at, by: "crew-quint" as never } } : {}),
          source: "self" as const,
          createdAt: at,
        })),
    );
  } finally {
    await repo.close();
  }
}

/**
 * Add a Muster departure to a seeded shift, with the id Muster's own slots carry —
 * `slot_<vessel>|<date>|<HH:MM>`, `|` and `:` included — so a page that takes the id from its URL
 * meets the characters a real one does (the 5:30 PM check-in bug, 18.5b). Returns the id.
 */
export async function plantSlotDeparture(shiftId: string, time: string): Promise<string> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const shift = await repo.getShift(shiftId as never);
    if (!shift) throw new Error(`plantSlotDeparture: no shift ${shiftId}`);
    const id = `slot_${shift.vesselId}|${shift.date}|${time}`;
    await repo.saveEvent({
      id: id as never,
      vesselId: shift.vesselId,
      date: shift.date,
      time,
      capacity: 12,
      status: "scheduled",
      source: "muster",
    });
    await repo.saveShift({ ...shift, eventIds: [...shift.eventIds, id as never] });
    return id;
  } finally {
    await repo.close();
  }
}

/**
 * Change a guest row behind the page's back (Phase 18.5a) — what another crew phone, or a guest
 * row going away, does while this phone's list is open. A bare row write, not the check-in path:
 * the test is about what the open list shows next.
 */
export async function untickGuestRow(id: string): Promise<void> {
  const client = new pg.Client(pgConnectionConfig(TEST_DATABASE_URL));
  await client.connect();
  try {
    await client.query("update guests set checked_in_at = null, checked_in_by = null where id = $1", [id]);
  } finally {
    await client.end();
  }
}

export async function deleteGuestRow(id: string): Promise<void> {
  const client = new pg.Client(pgConnectionConfig(TEST_DATABASE_URL));
  await client.connect();
  try {
    await client.query("delete from guests where id = $1", [id]);
  } finally {
    await client.end();
  }
}

/**
 * Cancel a booking behind the page's back (Phase 18.4) — the race where a party disappears while a
 * guest is filling in the form. A bare status flip, not the cancellation flow: the test is about
 * what the signing page does, not about refunds.
 */
export async function cancelReservationRow(id: string): Promise<void> {
  const client = new pg.Client(pgConnectionConfig(TEST_DATABASE_URL));
  await client.connect();
  try {
    await client.query("update reservations set status = 'cancelled' where id = $1", [id]);
  } finally {
    await client.end();
  }
}

/**
 * Plant a waiver version (Phase 18.2) — for the states the page cannot reach by posting, like a
 * version that took effect in the past. Posted by the admin every `resetAndSeed` creates.
 */
export async function plantWaiverTemplate(t: {
  id: string;
  version: string;
  body: string;
  effectiveFrom: string;
}): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    await repo.postWaiverTemplate({
      id: t.id as never,
      version: t.version,
      body: t.body,
      effectiveFrom: t.effectiveFrom,
      postedAt: t.effectiveFrom,
      postedBy: "crew-eric-stoffer",
    });
  } finally {
    await repo.close();
  }
}

/**
 * Plant a recorded payment against a seeded booking (#616) — the money a refund gives back.
 *
 * The `reservation` seed writes bookings with NO payments (every money assertion in
 * `calendar.spec.ts` reads off the pure fare+tax derivation), and adding one to the seed would
 * move those numbers under seven other specs. So the refund tests plant their own, the same
 * way `plantPendingReservation` does rather than driving a real checkout.
 *
 * `stripePaymentIntentId` matters: it is what `refundReservation` refuses without, and what a
 * `charge.refunded` webhook would find the row by.
 */
export async function plantPayment(p: {
  id: string;
  reservationId: string;
  amountCents: number;
  taxCents?: number;
  kind?: "full" | "deposit" | "balance";
  stripePaymentIntentId?: string;
  createdAt?: string;
}): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    await repo.savePayment({
      id: p.id as never,
      reservationId: p.reservationId as never,
      method: "stripe",
      kind: p.kind ?? "full",
      amountCents: p.amountCents,
      taxCents: p.taxCents ?? 0,
      currency: "usd",
      ...(p.stripePaymentIntentId ? { stripePaymentIntentId: p.stripePaymentIntentId } : {}),
      status: "succeeded",
      createdAt: p.createdAt ?? "2026-07-06T00:00:00.000Z",
    });
  } finally {
    await repo.close();
  }
}

/**
 * Put a cancelled Muster event back to `scheduled` behind the app's back (#616).
 *
 * There is no product path to this state and there must not be — it models the HALF-APPLIED
 * cancel: `cancelReservation` writes the reservation, then the event, and a crash between them
 * leaves the reservation Cancelled with its boat still held. Written straight through the pool
 * rather than the port for exactly that reason; the port's `cancelEventIfUnclaimed` only moves
 * in the other direction.
 */
export async function reopenEvent(date: string, time: string): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const events = await repo.listEvents();
    const target = events.find(
      (e) => e.date === date && e.time === time && e.source === "muster",
    );
    if (!target) throw new Error(`no muster event at ${date} ${time}`);
    await repo.saveEvent({ ...target, status: "scheduled" });
  } finally {
    await repo.close();
  }
}

/** Flip an admin's `active` flag — the per-person revoke lever (DEC-092). */
export async function setAdminActive(handle: string, active: boolean): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const a = await repo.getAdminByHandle(handle);
    if (!a) throw new Error(`no admin with handle "${handle}"`);
    await repo.saveAdmin({
      ...a,
      active,
      deactivatedAt: active ? null : "2026-07-06T09:00:00.000Z",
    });
  } finally {
    await repo.close();
  }
}

/**
 * Truncate the test DB, seed the operator admin, then run the named dev seeds.
 *
 * `SEED_TODAY` pins the seeds to the run's single day (#646). The reservation fixture derives
 * its window from today, and this runs in a fresh subprocess on every `beforeEach` — without
 * this the DB and the specs would each read their own clock dozens of times across a run, and a
 * month rollover partway through would silently desync every remaining test.
 */
export async function resetAndSeed(...seeds: SeedName[]): Promise<void> {
  await resetTestDb();
  await seedAdmin({ id: "crew-eric-stoffer", handle: "eric", name: "Eric" });
  for (const name of seeds) {
    execFileSync(TSX, [SEED_SCRIPTS[name]], {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, SEED_TODAY: TODAY },
      stdio: "pipe",
    });
  }
}

// ── Sign-in: once per identity, through the real door ─────────────────────────

/**
 * **Every session in the suite comes through the 6-digit code door** (DEC-081, DEC-174) — the
 * one way a real person gets in. Nothing here mints a session.
 *
 * Two identities carry almost the whole suite — admin `eric` and crew `crew-quint`, 213 of 222
 * sign-in calls when this was written. `auth.setup.ts` signs each in ONCE per run, through the
 * door, and saves the resulting cookie here; a spec asking for either loads it instead of walking
 * the door again. Everyone else walks the door every time, and so does every spec whose subject
 * is sign-in itself.
 *
 * **Why loading a saved cookie is still honest.** A crew session is a signed, stateless cookie
 * (`app/lib/auth.ts`), so the same one is valid across every `resetAndSeed` for as long as its
 * 14 days last; an admin session is re-checked against `admins.active` on every request, and
 * `resetAndSeed` re-seeds that row each time. So a loaded session behaves exactly like one the
 * spec had just signed in for — which is what a revoke spec relies on when it flips `active` and
 * reloads.
 */
export const AUTH_DIR = "e2e/.auth";
const SAVED_CREW: Record<string, string> = { "crew-quint": `${AUTH_DIR}/crew-quint.json` };
const SAVED_ADMIN: Record<string, string> = { eric: `${AUTH_DIR}/admin-eric.json` };

/** The saved-session files `auth.setup.ts` writes: who, how, and where. */
export const SAVED_IDENTITIES = [
  { email: "quint@bb.test", asAdmin: false, file: SAVED_CREW["crew-quint"]! },
  { email: "eric@bb.test", asAdmin: true, file: SAVED_ADMIN.eric! },
] as const;

async function loadSavedSession(page: Page, file: string): Promise<void> {
  let state: { cookies: Parameters<ReturnType<Page["context"]>["addCookies"]>[0] };
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(
      `${file} is missing — it is written by the "setup" project. Run through a project that ` +
        `depends on it (every project in playwright.config.ts does), not with --no-deps.`,
    );
  }
  // The setup project signs in on the prebuilt server, where NODE_ENV=production marks every cookie
  // Secure; WebKit then refuses them over the dev server's plain http (`playwright.config.ts`,
  // iPhone project). `next dev` itself sets these same cookies without the flag, so loading them
  // unmarked there is the cookie that server would have issued — the value, and so the session,
  // is untouched.
  const onDev = serverOf(base.info().project.metadata) === "dev";
  await page
    .context()
    .addCookies(onDev ? state.cookies.map((c) => ({ ...c, secure: false })) : state.cookies);
}

/**
 * The timeout multiplier for the server the running test's project drives (#763, #1169) — read
 * from the project, not the run, since the two servers run side by side. Call it inside a test.
 */
export function slowPath(): number {
  return SLOW_PATH_FOR[serverOf(base.info().project.metadata)];
}

const CODE_SENT = /a 6-digit code is on its way/i;

/**
 * Sign in at `/crew` with an email and the code it was sent — the flow a crew member uses.
 * The code comes from `/crew/dev-code`, the dev-only echo (hard 404 on a production deploy).
 */
export async function signInWithCode(page: Page, email: string): Promise<void> {
  // A fresh browser, as far as this origin knows. A spec that switches people mid-test (crew A,
  // then crew B on the same page) would otherwise land on A's app instead of the sign-in form —
  // the magic link overwrote whatever session was there; the door does not, correctly.
  await page.context().clearCookies();
  // Reload until the form is there. On the dev-server path (`next dev`) the first request compiles
  // `/crew`, and that compile sometimes fails with `SyntaxError: Unexpected end of JSON input`
  // from Next's own manifest read — seen on a green lane-B run and on PR #1094's red one. The
  // setup project made this the first request of every run, so it always takes the hit; a
  // reload gets the finished compile. A real rendering defect still fails, one budget later.
  const emailField = page.getByLabel(/sign in with your crew email/i);
  await expect(async () => {
    await page.goto("/crew");
    await expect(emailField).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 * slowPath() });
  await emailField.fill(email);
  await page.getByRole("button", { name: /email me a code/i }).click();
  await expect(page.getByText(CODE_SENT)).toBeVisible();
  const res = await page.request.get(`/crew/dev-code?email=${encodeURIComponent(email)}`);
  const code = (await res.text()).trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error(`signInWithCode: /crew/dev-code gave no code for ${email} (HTTP ${res.status()})`);
  }
  await page.getByLabel(/enter your code/i).fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the SESSION, not the URL. The code screen is itself `/crew?stage=code`, so a URL
  // check passes the instant the button is clicked — the first cut of this saved a crew
  // "session" holding only the pending-email cookie, and every spec loading it was signed out.
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name === "muster_session"))
    .toBe(true);
  await expect(page.getByLabel(/enter your code/i)).toHaveCount(0);
}

/** A crew session becomes an admin one the way the operator does it: the drawer's control. */
export async function switchToAdminFromDrawer(page: Page): Promise<void> {
  await page.locator(`summary[aria-label="Open menu"]`).click();
  await page.getByRole("button", { name: /switch to admin/i }).click();
  await page.waitForURL(/\/admin/);
}

/** The email the door needs for a crew id, read from the test database. */
async function emailOf(crewId: string): Promise<string> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const crew = (await repo.listCrewMembers()).find((c) => String(c.id) === crewId);
    if (!crew?.email) {
      throw new Error(
        `sign-in: crew "${crewId}" ${crew ? "has no email" : "is not seeded"} — the code door ` +
          `needs one. Seed it before signing in.`,
      );
    }
    return crew.email;
  } finally {
    await repo.close();
  }
}

/** Sign in as a crew member. Lands on a clean `/crew`. */
export async function signInAsCrew(page: Page, crewId: string): Promise<void> {
  const saved = SAVED_CREW[crewId];
  if (saved) {
    await loadSavedSession(page, saved);
    await page.goto("/crew");
    return;
  }
  await signInWithCode(page, await emailOf(crewId));
}

/**
 * Sign in as an admin, by HANDLE (`getAdminByHandle`, DEC-092). Lands on the at-risk board.
 *
 * Refuses an inactive admin up front: `readSubject` would refuse the session on the next request
 * anyway, but a spec would then fail looking like a routing bug rather than saying the handle is
 * deactivated.
 */
export async function signInAsAdmin(page: Page, handle: string): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  let adminId: string;
  try {
    const admin = await repo.getAdminByHandle(handle);
    if (!admin || !admin.active) {
      throw new Error(`signInAsAdmin: no ACTIVE admin with handle "${handle}"`);
    }
    adminId = String(admin.id);
  } finally {
    await repo.close();
  }
  const saved = SAVED_ADMIN[handle];
  if (saved) {
    await loadSavedSession(page, saved);
  } else {
    await signInWithCode(page, await emailOf(adminId));
    await switchToAdminFromDrawer(page);
  }
  await page.goto("/admin/at-risk");
}

/**
 * Delete a crew row behind the app's back — the operator removing someone while they are signed
 * in (#936). No product path does this and none should; it is here so a spec can hold a session
 * for a crew member who no longer exists, which the door (rightly) will not mint directly.
 * Only works on a row nothing else references (`time_punches` restricts).
 */
export async function removeCrewRow(crewId: string): Promise<void> {
  const client = new pg.Client(pgConnectionConfig(TEST_DATABASE_URL));
  await client.connect();
  try {
    await client.query("delete from crew_members where id = $1", [crewId]);
  } finally {
    await client.end();
  }
}

// ── Client-island hydration (#642) ───────────────────────────────────────────

/**
 * Has React taken ownership of this element yet?
 *
 * A `"use client"` island is server-rendered, so its markup — buttons included — is in
 * the first HTML response and passes every Playwright actionability check immediately.
 * Until hydration runs, though, no handler is attached and a click is a **no-op that
 * reports success**. That is the `offering-catalog:69` failure: the click adds no row,
 * and the next locator waits out its full 15s against a page that will never change.
 *
 * The probe reads React's own bookkeeping. React DOM stamps `__reactFiber$<hash>` and
 * `__reactProps$<hash>` onto each host node it manages, and for a hydrated tree that
 * happens at hydration — so the key's presence is the exact condition the failure is
 * about, not a proxy for it. `e2e/island-hydration.spec.ts` negative-controls this
 * against a page whose bundle is blocked, because a probe that always answered "yes"
 * would turn every call below into a no-op wait and go green fixing nothing.
 *
 * Yes, it reads a React internal. The honest alternatives are worse: there is no public
 * "hydrated" signal in the App Router, and every substitute (sleep, retry-the-click,
 * assert-then-retry) either slows the whole suite or hides the failure it should report.
 * Test-only, one call site, and it fails loudly rather than silently if React renames
 * the key — the negative control asserts the probe can return `true`.
 */
export async function isHydrated(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) =>
    Object.keys(el).some((k) => k.startsWith("__reactProps$")),
  );
}

/**
 * Block until React owns this element, or fail loudly saying which one didn't.
 *
 * **Scaled by `slowPath()` like every other budget (#763).** This one matters most: hydration is
 * precisely what compile-on-demand delays, so a fixed ceiling here is tightest exactly when the
 * server is slowest. Left unscaled it was 15s against a 20s `expect` ceiling on the dev path —
 * the guard written to fix a flake class would have become the next flake in it.
 */
async function waitForHydrated(locator: Locator): Promise<void> {
  await expect
    .poll(() => isHydrated(locator), {
      timeout: 15_000 * slowPath(),
      message: `island never hydrated: ${locator}`,
    })
    .toBe(true);
}

/**
 * Click an island control once React is actually listening.
 *
 * Use this for **any** interaction whose effect depends on a client handler — adding a
 * row, opening a drawer, toggling state. A plain `.click()` on a server-rendered island
 * button is a race the fast machine always wins and CI sometimes loses.
 *
 * Plain server-form controls (a submit button that POSTs, an `<a>`) do NOT need it: they
 * work without JS by design, so waiting on hydration there would be waiting on nothing.
 */
export async function clickHydrated(locator: Locator): Promise<void> {
  await waitForHydrated(locator);
  await locator.click();
}

/**
 * Type into a field that arrives **server-rendered with a prefill**, once React owns it.
 *
 * The failure this exists for is nastier than the un-hydrated click, because the typing takes
 * and then silently un-takes. `fill()` writes the DOM value; React's reconcile then re-applies
 * the element's `defaultValue`, and what posts is the prefill — or, as measured on issue #762,
 * the two spliced together. The form is a plain server form, so nothing here is "controlled" and
 * `setCheckedHydrated`'s reasoning does not obviously apply; the value is clobbered anyway.
 *
 * **It only bites under load.** In an isolated run the page is warm and the fill lands after
 * hydration; in a full suite on the dev-server path (`next dev`, compile-on-demand) hydration
 * arrives later than the fill. That is the whole reason #762 reproduced only in a full-suite run
 * and cost ~35 minutes per diagnostic attempt — and why it read as a product defect in the cancel
 * outcome for weeks. It was the refund amount never reaching the server.
 *
 * Use this for any `fill()` into a field whose default the server rendered. A blank field needs
 * nothing: there is no prefill to restore over your value.
 */
export async function fillHydrated(locator: Locator, value: string): Promise<void> {
  await waitForHydrated(locator);
  await locator.fill(value);
}

/**
 * Tick or untick a **controlled** checkbox (`checked={state}`) inside an island.
 *
 * The same two failures as `selectOptionHydrated`, and the checkout waiver is the
 * expensive case: ticking it pre-hydration sets the box but never runs `setWaiver`, so
 * the DEC-110 gate on **Book & pay** stays shut and the assertion times out — on the
 * payment path, in CI, intermittently. An uncontrolled checkbox in a server form (the
 * `weekday`/`vesselIds` boxes) needs none of this.
 */
export async function setCheckedHydrated(
  locator: Locator,
  checked: boolean,
): Promise<void> {
  await waitForHydrated(locator);
  await locator.setChecked(checked);
}

/**
 * Choose an option on a select whose `onChange` does the work — the crew filter that
 * navigates, the departure-time pair the island reads on "+ Add time".
 *
 * Two ways this loses without the wait, not one. The handler may not be attached yet
 * (as with a click), and a **controlled** select (`value={state}`) will have whatever
 * Playwright set reverted the moment React hydrates and asserts its own value. The
 * second is nastier: the selection visibly takes and then silently un-takes.
 */
export async function selectOptionHydrated(
  locator: Locator,
  value: Parameters<Locator["selectOption"]>[0],
): Promise<void> {
  await waitForHydrated(locator);
  await locator.selectOption(value);
}

export const test = base;
export { expect };

/**
 * Plant a recorded shift change (#769), the way `formShifts` would have.
 *
 * Direct rather than driven through a real trip edit: producing one end to end needs a Xola pull
 * or a departure edit plus a cron tick, and the surface under test is the BANNER — what it says,
 * who it clears for, and whether a later change brings it back. Routing through
 * `recordShiftChanges` means the adapter written for this is exercised rather than bypassed, so
 * a broken insert still fails here.
 *
 * `startBefore`/`startAfter` are ISO departure instants; the surface subtracts the call lead.
 * Pass `null` for either to reproduce the pre-watermark row the banner must refuse to describe.
 */
export async function plantShiftChange(c: {
  shiftId: string;
  crewMemberId: string;
  changedAt: string;
  added?: string[];
  removed?: string[];
  startBefore?: string | null;
  startAfter?: string | null;
}): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    await repo.recordShiftChanges([
      {
        shiftId: c.shiftId as Parameters<typeof repo.listShiftChanges>[0],
        crewMemberId: c.crewMemberId as Parameters<typeof repo.listShiftChanges>[1],
        changedAt: c.changedAt,
        added: c.added ?? [],
        removed: c.removed ?? [],
        startBefore: c.startBefore ?? null,
        startAfter: c.startAfter ?? null,
      },
    ]);
  } finally {
    await repo.close();
  }
}
