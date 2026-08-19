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
  isHydrated,
  selectOptionHydrated,
  test,
  resetAndSeed,
  signInAsAdmin,
} from "./fixtures.js";

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
    // Reachable by ordinary navigation, not a crafted URL: refuse, correct, save, then press
    // Back. Without this, the form re-offers the values you already fixed, on a record that has
    // since been written with different ones.
    await signInAsAdmin(page, "spink");

    await page.goto("/admin/add-ons?sel=new");
    await page.fill('input[name="label"]', "Sunset Charcuterie");
    await page.fill('input[name="amount"]', "forty five");
    await page.getByRole("button", { name: "Create" }).click();
    // The draft exists — this is the #699 behaviour, asserted so the test can't pass by never
    // having stashed anything in the first place.
    await expect(page.locator('input[name="label"]')).toHaveValue("Sunset Charcuterie");

    // The restored form arrives as server-rendered HTML and React reconciles it a beat later.
    // Typing into it before that lands is a machine-speed race a person cannot lose (the
    // correction is wiped by the reconcile, and the ORIGINAL value posts again) — but Playwright
    // wins it every time, so wait for React to own the field before re-typing.
    await expect.poll(() => isHydrated(page.locator('input[name="amount"]'))).toBe(true);
    await page.fill('input[name="amount"]', "45.00");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);

    await page.goto("/admin/add-ons?sel=new&err=bad_amount");
    await expect(page.locator('input[name="label"]')).toHaveValue("");
    await expect(page.locator('input[name="amount"]')).toHaveValue("");
  });
});
