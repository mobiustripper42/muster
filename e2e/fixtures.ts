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
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { resetTestDb, TEST_DATABASE_URL } from "../db/reset-test.js";
import { SLOW_PATH } from "./slow-path.js";
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { issueMagicLink, randomSecret } from "../src/auth/magic-link.js";
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
 * (DEC-092). Its id is the operator crew id (`crew-eric-stoffer`, = OPERATOR_CREW_MEMBER_ID).
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

/** Seed an extra admin (e.g. a second operator for the per-person-revoke test). */
export async function seedExtraAdmin(
  a: { id: string; handle: string; name?: string; active?: boolean },
): Promise<void> {
  await seedAdmin(a);
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

/**
 * Mint a magic link against the TEST database and return its production-shaped path,
 * `/crew/auth?t=<secret>` — WITHOUT consuming it.
 *
 * **Why this exists.** The suite used to sign in by driving `/crew/dev-link`, an
 * unauthenticated HTTP route whose only job was to mint a session for any subject. That route
 * is being deleted, and 52 of 56 specs went through it. Minting here does the same work the
 * route did internally, with no endpoint standing between the public internet and a session.
 *
 * **It also makes the suite MORE production-like, not less.** `dev-link`'s button was, in its
 * own words, "the dev shortcut" — it posted straight to the consume endpoint and skipped the
 * interstitial. The path returned here is the real one: `/crew/auth` renders a prefetch-safe
 * GET page with a "Tap to sign in →" button, which exists because SMS link-preview bots fetch
 * the URL before the human does and a consuming GET would burn every relayed link in transit
 * (DEC-030). Every sign-in in the suite now goes through the page a crew member actually meets.
 */
async function mintAuthPath(
  subjectKind: "crew" | "admin",
  subjectId: string,
): Promise<string> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const { secret } = await issueMagicLink(
      repo,
      { subjectKind, subjectId, ttlMs: 15 * 60_000 },
      { now: new Date(), mintSecret: randomSecret },
    );
    return `/crew/auth?t=${encodeURIComponent(secret)}`;
  } finally {
    await repo.close();
  }
}

/** Mint a crew magic link without consuming it — for specs about the link itself (DEC-150). */
export async function crewAuthPath(crewId: string): Promise<string> {
  return mintAuthPath("crew", crewId);
}

/**
 * Tap the interstitial's button — **if it rendered at all**.
 *
 * DEC-150 (`crew/auth/route.ts:112-130`): a visitor already carrying a valid session for the very
 * subject the token names is redirected straight to their world and never sees a button. Signing
 * in twice inside one spec is ordinary — `island-hydration.spec.ts` does it, deliberately, to get
 * a second render with the JS bundle unblocked — so the fixture has to tolerate both shapes.
 *
 * `dev-link` hid this: its own button posted straight to the consume endpoint and always rendered,
 * whatever session you were holding. The first cut of this rewrite clicked unconditionally and
 * that one spec timed out waiting for a button the redirect had skipped.
 */
async function tapIfPresent(page: Page): Promise<void> {
  const tap = page.getByRole("button", { name: /tap to sign in/i });
  if ((await tap.count()) > 0) await tap.click();
}

/** Sign in as a crew member through the real `/crew/auth` interstitial. */
export async function signInAsCrew(page: Page, crewId: string): Promise<void> {
  await page.goto(await mintAuthPath("crew", crewId));
  await tapIfPresent(page);
  // Success lands on a clean /crew; a FAILED consume lands on /crew?auth=<reason>.
  // Exclude the failure param so a broken sign-in fails here, loudly, not later.
  await page.waitForURL((u) => u.pathname === "/crew" && !u.searchParams.has("auth"));
}

/**
 * Same flow, operator subject — lands on the at-risk board.
 *
 * Takes a HANDLE and resolves it to the admin's crew id, which is the lookup `dev-link` used to
 * do (`getAdminByHandle`, DEC-092). Specs say `signInAsAdmin(page, "eric")` and are unchanged.
 *
 * Deliberately mints an admin subject rather than signing in as crew and driving the drawer's
 * "Switch to admin" control. The switch is the real operator path and it has its own coverage in
 * `switcher.spec.ts`, `admin-nav.spec.ts` and `admin-gate.spec.ts`; making all 52 sign-ins walk
 * through a drawer would slow the suite and couple every admin spec to that component's markup.
 */
export async function signInAsAdmin(page: Page, handle: string): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  let adminId: string;
  try {
    const admin = await repo.getAdminByHandle(handle);
    // `active` too, which the deleted route checked and the first cut of this fixture dropped
    // (`/security-review`). `readSubject` refuses an inactive admin on the next request, so a spec
    // would have failed at `waitForURL` anyway — but it would have failed looking like a routing
    // bug rather than saying the handle is deactivated.
    if (!admin || !admin.active) {
      throw new Error(`signInAsAdmin: no ACTIVE admin with handle "${handle}"`);
    }
    adminId = String(admin.id);
  } finally {
    await repo.close();
  }
  await page.goto(await mintAuthPath("admin", adminId));
  await tapIfPresent(page);
  await page.waitForURL(/\/admin\/at-risk/);
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
 * **Scaled by `SLOW_PATH` like every other budget (#763).** This one matters most: hydration is
 * precisely what compile-on-demand delays, so a fixed ceiling here is tightest exactly when the
 * server is slowest. Left unscaled it was 15s against a 20s `expect` ceiling on the dev path —
 * the guard written to fix a flake class would have become the next flake in it.
 */
async function waitForHydrated(locator: Locator): Promise<void> {
  await expect
    .poll(() => isHydrated(locator), {
      timeout: 15_000 * SLOW_PATH,
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
 * hydration; in a full suite on the dev-server path (`E2E_PROD=0`, compile-on-demand) hydration
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
