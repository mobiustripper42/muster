/**
 * A validation error must not destroy your work, or show you somebody else's (#699).
 *
 * The operator hit this seeding the catalog: creating a new offering, one incomplete price
 * variation, and the form came back holding **an existing offering's data** with everything
 * typed gone. Reported as *"the error was mine; the data loss was not."*
 *
 * Three separate failures stacked, and this spec pins each so they can be fixed and kept fixed
 * independently:
 *
 *  1. The error redirect emitted `sel=<a freshly minted id>`, so the page no longer knew a
 *     creation was in progress — that id matches no row.
 *  2. Not knowing, the lookup fell through `?? visible[0]` and substituted an unrelated record.
 *  3. The re-render had nothing of what was typed, so every field came back on its default.
 *
 * **This needs an EXISTING record to reproduce.** With an empty catalog `visible.length === 0`
 * forces `creating` true and the substitution cannot happen — which is exactly why the existing
 * `offering-catalog.spec.ts`, which seeds nothing, has always passed straight through this bug.
 *
 * ## Why defect 3 is not fixable in the client, and what that means for this spec
 *
 * React 19's `startHostTransition` calls `HTMLFormElement.reset()` on every function-valued
 * `<form action>` — unconditionally, in the commit phase, before the action runs (verified in
 * `react-dom@19.2.7`, `cjs/react-dom-client.development.js`). There is no opt-out: the exported
 * `requestFormReset` is the same function the automatic path calls. Controlled `value` survives
 * only because React mirrors it into `defaultValue` on every update; `checked` and `selected`
 * are **not** mirrored, so a checkbox, radio or select reverts to its mount-time value however
 * much client state you wrap it in.
 *
 * So the fix is server-side — a short-lived draft of the submitted `FormData`, read back as the
 * *defaults* of the re-rendered form — and these tests are written against plain server forms
 * accordingly. **No hydration waits on the CRUD fields**, deliberately: they are uncontrolled
 * server-rendered inputs, a submit that beats hydration is a real POST that the server action
 * handles identically, and a wait here would be waiting on nothing (`fixtures.ts`). The
 * departure-times island is the one exception and uses the island helpers, because adding a
 * time genuinely needs its click handler.
 *
 * Every control type is asserted **on some surface**: text, textarea, number, checkbox, radio,
 * select, and the island. An earlier attempt asserted text fields only, passed, and hid the
 * fact that ticked checkboxes were cleared on every surface — including one that attempt had
 * declared fixed. A spec that covers six control types of seven reads exactly like one that
 * covers all seven.
 */
import {
  clickHydrated,
  expect,
  selectOptionHydrated,
  test,
  plantPayment,
  resetAndSeed,
  signInAsAdmin,
} from "./fixtures.js";
import { BOOKED, demoReservationId } from "./reservation-demo.js";

/** The minimum to get one saved offering on the page, so there is something to substitute. */
async function seedOneOffering(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/admin/locations?sel=new");
  await page.fill('input[name="name"]', "East Bank");
  await page.fill('textarea[name="pickupDescription"]', "Flats East Bank, dock 3");
  await page.fill('textarea[name="routeDescription"]', "Up the river and back");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/saved=1/);

  await page.goto("/admin/offerings?sel=new");
  await page.fill('input[name="name"]', "Existing Sunset Cruise");
  await page.selectOption('select[name="locationId"]', { label: "East Bank" });
  await page.locator('input[name="vesselIds"][value="vessel-hops"]').check({ force: true });
  await page.fill('input[name="seasonStart"]', "2026-05-01");
  await page.fill('input[name="seasonEnd"]', "2026-09-30");
  await page.locator('input[name="weekday"][value="5"]').check({ force: true });
  await page.fill('input[name="basePrice"]', "499");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/saved=1/);
}

/** One saved location, so the list has something the page could wrongly substitute. */
async function seedOneLocation(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/admin/locations?sel=new");
  await page.fill('input[name="name"]', "Existing East Bank");
  await page.fill('textarea[name="pickupDescription"]', "Flats East Bank, dock 3");
  await page.fill('textarea[name="routeDescription"]', "Up the river and back");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/saved=1/);
}

/** One saved add-on, same reason. */
async function seedOneAddOn(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/admin/add-ons?sel=new");
  await page.fill('input[name="label"]', "Existing Cooler of Ice");
  await page.fill('input[name="amount"]', "25.00");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/saved=1/);
}

test.describe("a validation error on a NEW record (#699)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew"); // seeds vessel-hops; no locations, no offerings
  });

  test("keeps you on the create form, keeps your typing, and never shows another record", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await seedOneOffering(page);

    // Start a SECOND offering and fill in enough to be worth losing.
    await page.goto("/admin/offerings?sel=new");
    await page.fill('input[name="name"]', "Moonlight Charter");
    await page.fill(
      'textarea[name="description"]',
      "The long description nobody wants to type twice.",
    );
    await page.selectOption('select[name="locationId"]', { label: "East Bank" });
    await page.fill('input[name="tripLengthMinutes"]', "90");
    // Everything else VALID, so exactly one refusal is possible and the test cannot pass on a
    // different error than the one it names.
    await page.fill('input[name="seasonStart"]', "2026-05-01");
    await page.fill('input[name="seasonEnd"]', "2026-09-30");
    await page.locator('input[name="weekday"][value="5"]').check({ force: true });
    await page.fill('input[name="basePrice"]', "499");

    // The island: a departure time is typed work too, and it reaches the server as hidden
    // `departureTime` inputs rather than a field of its own — so it is the one part of this
    // form whose restore can't come from a plain `defaultValue`.
    await selectOptionHydrated(page.getByLabel("New departure hour"), "18");
    await selectOptionHydrated(page.getByLabel("New departure minute"), "30");
    await clickHydrated(page.getByRole("button", { name: "+ Add time" }));
    await expect(page.getByText("18:30")).toBeVisible();

    // The location id is minted at seed time, so capture what the select actually holds rather
    // than hardcoding an id the seed doesn't promise.
    const locationId = await page.locator('select[name="locationId"]').inputValue();
    expect(locationId).not.toBe("");

    // Trigger a REAL validation refusal: no vessel selected → `bad_vessels`. Chosen over a
    // malformed price variation because it needs no island interaction, so nothing about the
    // trigger itself can race.
    await page.getByRole("button", { name: "Create" }).click();

    // The error is shown. (Which channel it arrives on is deliberately not asserted — that is
    // the fix's business; that the operator is TOLD is this test's business.)
    await expect(
      page.getByText("Pick at least one vessel", { exact: false }),
    ).toBeVisible();

    // 1 + 2 — still creating, and NOT showing the offering that already exists.
    await expect(page.getByRole("heading", { name: "New offering" })).toBeVisible();
    await expect(page.locator('input[name="name"]')).not.toHaveValue("Existing Sunset Cruise");

    // 3 — the typing survived. This is the half the operator actually lost.
    await expect(page.locator('input[name="name"]')).toHaveValue("Moonlight Charter");
    await expect(page.locator('textarea[name="description"]')).toHaveValue(
      "The long description nobody wants to type twice.",
    );
    await expect(page.locator('input[name="tripLengthMinutes"]')).toHaveValue("90");

    // Checkbox, select and island — the three React's form reset restores to their MOUNT values
    // rather than their submitted ones, and the three a controlled-state fix cannot reach.
    await expect(page.locator('input[name="weekday"][value="5"]')).toBeChecked();
    await expect(page.locator('select[name="locationId"]')).toHaveValue(locationId);
    await expect(page.getByText("18:30")).toBeVisible();
  });

  test("a stale ?sel= for a record that does not exist shows nothing, not the first one", async ({
    page,
  }) => {
    // Defect 2 on its own terms, reachable without any error at all: a bookmarked link to a
    // deleted offering, or a shared URL. `?? visible[0]` answered a question nobody asked —
    // and the answer looked exactly like a real selection, so there was no way to tell.
    await signInAsAdmin(page, "spink");
    await seedOneOffering(page);

    await page.goto("/admin/offerings?sel=does-not-exist");

    // Nothing is selected, so no editor renders — and crucially the existing offering's data
    // is NOT in it. Asserting the input is absent rather than merely holding a different value:
    // "shows nothing" is the fix, and a form full of blanks would also pass a value check while
    // being a different, worse behaviour.
    await expect(page.locator('input[name="name"]')).toHaveCount(0);

    // Failing visibly, not blankly. Before #699 this URL rendered a real-looking editor for a
    // record you never asked for; a blank panel would be an improvement and still leave the
    // reader guessing whether the offering is gone or the page is broken.
    await expect(page.getByText("That offering no longer exists")).toBeVisible();

    // The list is still usable — this is a recoverable dead end, not a trap.
    await expect(page.getByText("Existing Sunset Cruise")).toBeVisible();
  });
});

/**
 * The same defect on the other three admin CRUD surfaces (#699 lists all four).
 *
 * Offerings was the only one *observed* failing, because it is the only surface with enough
 * required fields to hit a refusal while creating. The other three have the identical shape and
 * lose the same way — they just need a refusal the browser will let through.
 *
 * **Each trigger below is server-only, deliberately.** Every one of these forms marks its fields
 * `required`, so the obvious refusals (empty name, empty label) never reach the action at all —
 * the browser blocks the submit and nothing is tested. A single space satisfies `required` and
 * fails the domain's `.trim()`; a non-numeric amount satisfies a text input and fails the parse.
 * A test that "passed" by never submitting would be the worst outcome here, so the trigger is
 * chosen to clear HTML validation and fail on the server, and each test asserts the surface's
 * own error copy so it cannot pass on some other refusal.
 */
test.describe("the same refusal on the other three admin surfaces (#699)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew"); // seeds vessel "Hops"; no locations, no add-ons
  });

  test("vessels: a refused save keeps you on the create form and keeps your typing", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    // "Hops" is already in the list from the seed — the record that must NOT be substituted.

    await page.goto("/admin/vessels?sel=new");
    await page.fill('input[name="name"]', " "); // clears `required`, fails the server's trim
    await page.fill('input[name="coiMaxPax"]', "12");
    await page.fill('textarea[name="notes"]', "Twin diesels, both replaced 2024.");
    // The hue radio is `sr-only` behind a swatch label, so the label intercepts the pointer —
    // hence `force`. It is a plain server-form radio; nothing here waits on React.
    await page.locator('input[name="hue"][value="3"]').check({ force: true });
    // Picked so the submit REACHES the server (#861 made the role `required`), which is what lets
    // the blank name be the thing that refuses. Without it the browser blocks first and this test
    // asserts a server refusal that never happened.
    await page.selectOption('select[name="crewRole"]', "role-captain");

    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("Give the vessel a name.")).toBeVisible();

    await expect(page.getByRole("heading", { name: "New vessel" })).toBeVisible();
    await expect(page.locator('input[name="name"]')).not.toHaveValue("Hops");

    // The half this surface still loses today — including the radio, which no amount of client
    // state would have saved (React never mirrors `checked` into `defaultChecked` on update).
    await expect(page.locator('input[name="coiMaxPax"]')).toHaveValue("12");
    await expect(page.locator('textarea[name="notes"]')).toHaveValue(
      "Twin diesels, both replaced 2024.",
    );
    await expect(page.locator('input[name="hue"][value="3"]')).toBeChecked();
    // The crew rule is part of "your typing" now (#861) — the draft carries the rows, so a
    // refusal that dropped them back to one blank row would be the same defect this test names.
    await expect(page.locator('select[name="crewRole"]')).toHaveValue("role-captain");
  });

  test("locations: a refused save keeps you on the create form and keeps your typing", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await seedOneLocation(page);

    await page.goto("/admin/locations?sel=new");
    await page.fill('input[name="name"]', "West Bank Ramp");
    await page.fill('textarea[name="pickupDescription"]', " "); // → pickup_required
    await page.fill('textarea[name="routeDescription"]', "Down past the point and back.");
    await page.fill('input[name="pickupLink"]', "https://maps.example.com/west-bank");

    await page.getByRole("button", { name: "Create" }).click();

    await expect(
      page.getByText("Add a pickup description", { exact: false }),
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "New location" })).toBeVisible();
    await expect(page.locator('input[name="name"]')).not.toHaveValue("Existing East Bank");

    await expect(page.locator('input[name="name"]')).toHaveValue("West Bank Ramp");
    await expect(page.locator('textarea[name="routeDescription"]')).toHaveValue(
      "Down past the point and back.",
    );
    await expect(page.locator('input[name="pickupLink"]')).toHaveValue(
      "https://maps.example.com/west-bank",
    );
  });

  test("add-ons: a refused save keeps you on the create form and keeps your typing", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await seedOneAddOn(page);

    await page.goto("/admin/add-ons?sel=new");
    await page.fill('input[name="label"]', "Sunset Charcuterie");
    await page.fill('input[name="amount"]', "forty five"); // text input, so this reaches the server
    // Both checkboxes moved off their defaults, so a remount is visible in them too: `required`
    // defaults off and `active` defaults ON for a new add-on. Plain server-form checkboxes —
    // the fix restores them from the submitted values, not from client state.
    await page.locator('input[name="required"]').check();
    await page.locator('input[name="active"]').uncheck();

    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("The amount must be a dollar figure", { exact: false })).toBeVisible();

    await expect(page.getByRole("heading", { name: "New add-on" })).toBeVisible();
    await expect(page.locator('input[name="label"]')).not.toHaveValue("Existing Cooler of Ice");

    await expect(page.locator('input[name="label"]')).toHaveValue("Sunset Charcuterie");
    await expect(page.locator('input[name="amount"]')).toHaveValue("forty five");
    await expect(page.locator('input[name="required"]')).toBeChecked();
    await expect(page.locator('input[name="active"]')).not.toBeChecked();
  });

  test("a successful save spends the draft — a stale ?err= URL does not repopulate it", async ({
    page,
  }) => {
    // The third leg of the draft's self-limiting design (`app/lib/form-draft.ts`): read only on
    // `?err=`, 60-second expiry, AND cleared on success. The first two are structural; this one
    // is a call that can silently do nothing, which is exactly what it did on the first cut —
    // the cookie is written with an explicit path, and deleting it without that path writes a
    // second expired cookie somewhere else and leaves the live one alone.
    //
    // Reachable by ordinary navigation, not a crafted URL: refuse, save something, then press
    // Back inside the minute. Without the clear, the form re-offers a spent draft's values.
    await signInAsAdmin(page, "spink");

    await page.goto("/admin/add-ons?sel=new");
    await page.fill('input[name="label"]', "Sunset Charcuterie");
    await page.fill('input[name="amount"]', "forty five");
    await page.getByRole("button", { name: "Create" }).click();
    // The draft exists — this is the #699 behaviour, asserted so the test can't pass by never
    // having stashed anything in the first place.
    await expect(page.locator('input[name="label"]')).toHaveValue("Sunset Charcuterie");

    // Now save something successfully. **Deliberately on a fresh form, not by correcting the
    // restored one** — correcting in place is its own defect (issue #783: the restored form
    // swallows an edit made before React reconciles it, and re-posts the original), and a test
    // that walks through a known-broken path is measuring two things and reporting one.
    await page.goto("/admin/add-ons?sel=new");
    await page.fill('input[name="label"]', "Cooler of Ice");
    await page.fill('input[name="amount"]', "25.00");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);

    // The draft is spent. Reaching an `?err=` URL again — the Back button, a bookmark — must
    // show an empty create form, not the typing from before the save.
    await page.goto("/admin/add-ons?sel=new&err=bad_amount");
    await expect(page.locator('input[name="label"]')).toHaveValue("");
    await expect(page.locator('input[name="amount"]')).toHaveValue("");
  });
});

/**
 * The same defect on the surfaces #699 didn't name (#780).
 *
 * Two things here are NOT true of #699's four CRUD surfaces, and both change what the fix has
 * to do:
 *
 *  1. **These forms are per-row.** A punch card, a time-off row — the same `<form>` is rendered
 *     once per record. A draft keyed only by surface repopulates EVERY row with one row's
 *     submitted values, which is #699's "shows you another record" defect arriving through the
 *     mechanism built to prevent it. So each test below asserts a SECOND, untouched row still
 *     holds its own values. That assertion fails against a surface-only draft, which is the
 *     point of it.
 *  2. **Two of the six live under `/crew`**, where the cookie's `Path` (`form-draft.ts`) has to
 *     follow the route. Those are in `crew-form-error.spec.ts` — same defect, different sign-in.
 *
 * `/admin/time-clock`'s ADD form is deliberately absent from this file: it already restores, by
 * a different mechanism that predates the draft (`actions.ts` rides `aday`/`ain`/`aout`/`anext`/
 * `acrew` back as params, and `page.tsx` reads them as `retry`). It is covered by
 * `admin-time-clock.spec.ts`. Only the edit form was unprotected.
 */

/**
 * The pay period has to be one that's already over, or an evening punch is refused as `future`
 * before the refusal under test can happen. Same helper and same reason as
 * `admin-time-clock.spec.ts` — duplicated rather than shared because a spec that reaches into
 * another spec for setup breaks both when either moves.
 */
async function usePreviousPeriod(page: import("@playwright/test").Page): Promise<void> {
  const select = page.getByLabel("Pay period");
  const values = await select
    .locator("option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  const current = await select.inputValue();
  const i = values.indexOf(current);
  expect(i, "the current period must be in the list").toBeGreaterThan(0);
  await select.selectOption(values[i - 1]!);
  await page.waitForURL(/period=/);
}

/** `2026-05-01` → `2026-05-02`. The punches need two different days to be two rows. */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A day comfortably in the future — a block dated in the past is filtered off the list. */
function daysFromToday(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test.describe("a refused edit on the per-row surfaces (#780)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("time-clock: a refused edit keeps the typed time AND the box the operator unticked", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/time-clock");
    await usePreviousPeriod(page);

    // Read the day off the page rather than hardcoding one — a fixed date rots the moment the
    // calendar passes it, which is how `book-availability.spec.ts` broke.
    const dayOne = (await page.locator("#add-day").getAttribute("min"))!;
    const dayTwo = nextDay(dayOne);

    // An OVERNIGHT punch: in 22:00, out 02:00 the next day. The next-day box is what makes it
    // legal, which is what lets the refusal below turn on unticking it.
    await page.locator("#add-day").fill(dayOne);
    await page.locator("#add-in").fill("22:00");
    await page.locator("#add-out").fill("02:00");
    await page.locator('form:has(#add-day) input[name="outNextDay"]').check();
    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL(/added=1/);

    // A second, ordinary punch — the row that must come back untouched.
    await page.locator("#add-day").fill(dayTwo);
    await page.locator("#add-in").fill("09:00");
    await page.locator("#add-out").fill("17:00");
    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL(/added=1/);

    const rows = page.locator("[data-punch-row]");
    await expect(rows).toHaveCount(2);
    const overnight = rows.filter({ has: page.locator('input[name="inTime"][value="22:00"]') });
    const ordinary = rows.filter({ has: page.locator('input[name="inTime"][value="09:00"]') });

    // The refusal: untick "out is next day" and move the out time to 03:00, which now reads as
    // 03:00 on the SAME day — before the 22:00 in-time. Server-only; no HTML validation blocks
    // it, and `<input type="time">` has nothing to say about it.
    //
    // 03:00 rather than leaving it at 02:00 **deliberately**: the stored value IS 02:00, so a
    // form that restored nothing at all would still render 02:00 and the assertion below would
    // pass while proving nothing. A value the record cannot produce is the only one that
    // distinguishes "the draft came back" from "the default happened to match".
    await overnight.locator('input[name="outTime"]').fill("03:00");
    await overnight.locator('input[name="outNextDay"]').uncheck();
    await overnight.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/can’t end before it starts/)).toBeVisible();

    // The typed value survived — and so did the UNTICKED box. An unticked checkbox posts
    // nothing, and that nothing is the operator's answer: re-ticking it from the stored record
    // would silently reinstate the very thing they were trying to change.
    await expect(overnight.locator('input[name="outTime"]')).toHaveValue("03:00");
    await expect(overnight.locator('input[name="outNextDay"]')).not.toBeChecked();

    // …and it went to that row ONLY. This is the assertion a surface-keyed draft fails: the
    // other punch card must still hold its own out time, not the refused row's.
    await expect(ordinary.locator('input[name="outTime"]')).toHaveValue("17:00");
  });

  test("blocks: a refused edit keeps the typing AND keeps editing the block it refused", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await seedOneLocation(page);

    // Create a location block to edit. Dated forward, because a past block is filtered off the
    // registry by default and the editor would have nothing to select.
    const day = daysFromToday(30);
    await page.goto("/admin/blocks");
    await page.selectOption('select[aria-label="Block location"]', { label: "Existing East Bank" });
    await page.locator('input[aria-label="Block date"]').fill(day);
    await page.locator('input[aria-label="Block start time"]').fill("09:00");
    await page.locator('input[aria-label="Block end time"]').fill("17:00");
    await page.locator('input[aria-label="Block reason"]').fill("river closed");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/sel=block-/);

    // Now refuse an EDIT: an end time before the start (`bad_window`). Server-only — two
    // `<input type="time">`s know nothing about each other.
    await page.locator('input[aria-label="Block reason"]').fill("engine service");
    await page.locator('input[aria-label="Block end time"]').fill("08:00");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/Check the time window/)).toBeVisible();

    // **Still editing the same block.** The refusal redirect dropped `?sel=` entirely, which
    // silently turns the edit panel back into a create form — and the hidden `id` empties with
    // it, so correcting the time and saving again would file a SECOND block instead of fixing
    // the first. Delete only renders while editing, so its presence is the cheap proof.
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();

    // The typing survived. "engine service" cannot come from the stored record — that still
    // says "river closed" — so this distinguishes a restore from a re-render.
    await expect(page.locator('input[aria-label="Block reason"]')).toHaveValue("engine service");
    await expect(page.locator('input[aria-label="Block end time"]')).toHaveValue("08:00");
    await expect(page.locator('input[aria-label="Block start time"]')).toHaveValue("09:00");
    await expect(page.locator('input[aria-label="Block date"]')).toHaveValue(day);
  });

  test("time-off: a refused range keeps the crew member as well as the dates", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto("/admin/time-off");

    // The crew select is the field worth proving here: React never mirrors `selected` on update,
    // so a `<select>` is one of the three controls no amount of client state would have saved.
    const start = daysFromToday(20);
    const end = daysFromToday(10);
    await page.selectOption("#crewMemberId", { index: 1 });
    const picked = await page.locator("#crewMemberId").inputValue();
    expect(picked).not.toBe("");
    await page.locator("#start").fill(start);
    await page.locator("#end").fill(end);
    await page.getByRole("button", { name: /Add/ }).click();

    await expect(page.getByText(/end date is before the start/)).toBeVisible();

    await expect(page.locator("#crewMemberId")).toHaveValue(picked);
    await expect(page.locator("#start")).toHaveValue(start);
    await expect(page.locator("#end")).toHaveValue(end);
  });
});

/**
 * The calendar's money pane refuses on its OWN params (#780).
 *
 * Every other surface in this file gates its draft read on `?err=`. This one never sets `err`:
 * it refuses with `cancelErr`, `refundErr` or `balanceErr`, because three independent actions
 * share one pane and a single code could not say which of them spoke. A draft gated on `?err=`
 * would therefore be written on every refusal here and read on none — the fix would look done,
 * the tests would be green if they only checked the cookie, and the box would still come back
 * holding the prefill.
 */
test.describe("a refused refund on the calendar pane (#780)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("keeps the amount the operator typed, not the prefill", async ({ page }) => {
    const reservationId = demoReservationId(BOOKED.date, BOOKED.time);
    // Refundable money, so the refund box renders at all.
    await plantPayment({
      id: "pay-e2e-780",
      reservationId,
      amountCents: 58880,
      taxCents: 3980,
    });

    await signInAsAdmin(page, "spink");
    await page.goto(
      `/admin/calendar/${encodeURIComponent(reservationId)}?date=${BOOKED.date}`,
    );

    // Over the refundable ceiling — server-only by construction: the box is a plain text input
    // with `inputMode="decimal"` and no max, and `startRefund` re-derives the ceiling rather
    // than trusting the form.
    const typed = "9999.00";
    const box = page.getByTestId("refund-form").locator('input[name="amount"]');
    const prefill = await box.inputValue();
    expect(prefill).not.toBe(typed);
    await box.fill(typed);
    await page.getByTestId("refund-form").getByRole("button", { name: "Refund" }).click();

    await expect(page.getByText(/more than this booking can give back/)).toBeVisible();

    // The figure survives. `defaultValue` here is a server-computed prefill, so a form that
    // restored nothing would come back holding a plausible number that is NOT the one the
    // operator typed — the worst shape for a money field, because it looks filled in.
    await expect(page.getByTestId("refund-form").locator('input[name="amount"]')).toHaveValue(
      typed,
    );
  });

  test("keeps the override amount typed on the CANCEL confirm, which is a second box", async ({
    page,
  }) => {
    // Found by `@code-review` on this branch. The cancel confirm carries its OWN amount box — an
    // override, deliberately blank, because a prefill there cannot follow the radio without JS
    // and would refund at the wrong reason's rate. `cancelBooking` validates it with the same
    // `parseDollarsToCents` check as `startRefund` four lines away, and only the latter stashed.
    //
    // What makes it worth its own test rather than a one-line fix: the cancel COMMITS before the
    // amount is parsed, so the confirm screen the operator typed into no longer exists on the
    // page they land on. Their figure has to survive into the standalone refund box or it is
    // gone — and that box has a prefill of its own, so losing it shows a plausible wrong number
    // rather than an empty field.
    const reservationId = demoReservationId(BOOKED.date, BOOKED.time);
    await plantPayment({
      id: "pay-e2e-780b",
      reservationId,
      amountCents: 58880,
      taxCents: 3980,
    });

    await signInAsAdmin(page, "spink");
    await page.goto(
      `/admin/calendar/${encodeURIComponent(reservationId)}?date=${BOOKED.date}&cancel=1`,
    );

    const typed = "five hundred";
    await page.locator("#cancel-refund-amount").fill(typed);
    await page.getByTestId("cancel-confirm").getByRole("button", { name: /^Cancel/ }).click();

    await expect(page.getByText(/Enter an amount like/)).toBeVisible();

    await expect(page.getByTestId("refund-form").locator('input[name="amount"]')).toHaveValue(
      typed,
    );
  });
});
