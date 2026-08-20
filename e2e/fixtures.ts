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
import { TODAY } from "./reservation-demo.js";

/** Local tsx binary — resolved explicitly so we don't depend on PATH/npx. */
const TSX = "node_modules/.bin/tsx";

const SEED_SCRIPTS = {
  crew: "db/seed-crewapp-dev.ts",
  atrisk: "db/seed-atrisk-dev.ts",
  outbox: "db/seed-outbox-dev.ts",
  reservation: "db/seed-reservation-dev.ts",
  xola: "db/seed-xola-dev.ts",
  concurrent: "db/seed-concurrent-dev.ts",
} as const;

type SeedName = keyof typeof SEED_SCRIPTS;

/**
 * The e2e operator: a seeded admin whose short handle is `spink` — what every
 * `signInAsAdmin(page, "spink")` resolves through the dev-link handle→id lookup
 * (DEC-092). Its id is the operator crew id (`crew-spink`, = OPERATOR_CREW_MEMBER_ID).
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
 * Plant a live customer checkout-hold on a slot (12.1, DEC-109) — the transient 15-minute soft
 * reservation another buyer takes while they are paying (#620).
 *
 * Written straight through the port rather than by driving the funnel: acquiring one for real
 * needs a Stripe session, and the thing under test is whether `/book` SUBTRACTS a live hold, not
 * how the hold got there. `expiresAt` is caller-supplied so a test can plant an expired one and
 * prove the slot stays on sale — the lazy-on-read half of the contract, which has no cron behind
 * it and so is only ever exercised by a comparison at derive time.
 */
export async function plantCheckoutHold(h: {
  id: string;
  vesselId: string;
  date: string;
  time: string;
  offeringId: string;
  guestCount: number;
  expiresAt: string;
}): Promise<void> {
  const repo = PostgresRepository.fromConnectionString(TEST_DATABASE_URL);
  try {
    const result = await repo.acquireCheckoutHold({
      id: h.id as never,
      vesselId: h.vesselId as never,
      date: h.date,
      time: h.time,
      source: "muster",
      offeringId: h.offeringId as never,
      guestCount: h.guestCount,
      expiresAt: h.expiresAt,
      createdAt: "2026-07-06T00:00:00.000Z",
    });
    if (!result.acquired) throw new Error(`hold not acquired for ${h.vesselId} ${h.date} ${h.time}`);
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
 * way `plantCheckoutHold` does rather than driving a real checkout.
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
  await seedAdmin({ id: "crew-spink", handle: "spink", name: "Spink" });
  for (const name of seeds) {
    execFileSync(TSX, [SEED_SCRIPTS[name]], {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, SEED_TODAY: TODAY },
      stdio: "pipe",
    });
  }
}

/** Drive the real dev-link sign-in (the button POSTs straight to /crew/auth). */
export async function signInAsCrew(page: Page, crewId: string): Promise<void> {
  await page.goto(`/crew/dev-link?crew=${encodeURIComponent(crewId)}`);
  await page.getByRole("button", { name: /tap to sign in/i }).click();
  // Success lands on a clean /crew; a FAILED consume lands on /crew?auth=<reason>.
  // Exclude the failure param so a broken sign-in fails here, loudly, not later.
  await page.waitForURL((u) => u.pathname === "/crew" && !u.searchParams.has("auth"));
}

/** Same flow, operator subject — lands on the at-risk board. */
export async function signInAsAdmin(page: Page, handle: string): Promise<void> {
  await page.goto(`/crew/dev-link?admin=${encodeURIComponent(handle)}`);
  await page.getByRole("button", { name: /tap to sign in/i }).click();
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
