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
 *  1. The error redirect emitted `sel=` (empty) because a new record has no id, so the page no
 *     longer knew a creation was in progress.
 *  2. Not knowing, the lookup fell through `?? visible[0]` and substituted an unrelated record.
 *  3. The redirect itself remounted the form, discarding every uncontrolled input.
 *
 * **This needs an EXISTING offering to reproduce.** With an empty catalog `visible.length === 0`
 * forces `creating` true and the substitution cannot happen — which is exactly why the existing
 * `offering-catalog.spec.ts`, which seeds nothing, has always passed straight through this bug.
 */
import {
  expect,
  isHydrated,
  setCheckedHydrated,
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

    // Trigger a REAL validation refusal: no vessel selected → `bad_vessels`. Chosen over a
    // malformed price variation because it needs no island interaction, so a hydration race
    // cannot make this test lie about which failure it is exercising.
    //
    // `clickHydrated`, not `.click()` — the form is a client island now, and a submit that
    // beats hydration does a REAL post, navigates, and loses the values. That is not a test
    // artifact: it is the genuine limit of this fix, and it is why the assertions below would
    // otherwise fail intermittently rather than honestly.
    // Wait for the FORM, not the button. `clickHydrated` probes the element it clicks, and
    // `SubmitButton` is already its own client component (`useFormStatus`) — so it reports
    // hydrated while the enclosing ActionForm still isn't listening, and the submit falls
    // through to a native POST. Probing the wrong element is indistinguishable from a passing
    // wait, which is how this spec quietly measured nothing on the first attempt.
    await expect.poll(() => isHydrated(page.locator("form").first())).toBe(true);
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

    // Checkboxes are part of "what you typed" (#699). Friday was ticked before the refusal.
    await expect(page.locator('input[name="weekday"][value="5"]')).toBeChecked();
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
    // Probe the card's own field: these pages carry more than one form, so a poll on
    // `form.first()` can resolve against a different one and read as a passing wait.
    await expect.poll(() => isHydrated(page.locator('input[name="name"]'))).toBe(true);
    await page.fill('input[name="name"]', " "); // clears `required`, fails the server's trim
    await page.fill('input[name="coiMaxPax"]', "12");
    await page.fill('textarea[name="notes"]', "Twin diesels, both replaced 2024.");
    // The hue radio is `sr-only` behind a swatch label, so the label intercepts the pointer —
    // `setChecked` can never reach it. Wait for hydration explicitly, then force the click.
    const hue = page.locator('input[name="hue"][value="3"]');
    await expect.poll(() => isHydrated(hue)).toBe(true);
    await hue.check({ force: true });

    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("Give the vessel a name.")).toBeVisible();

    await expect(page.getByRole("heading", { name: "New vessel" })).toBeVisible();
    await expect(page.locator('input[name="name"]')).not.toHaveValue("Hops");

    // The half this surface still loses today.
    await expect(page.locator('input[name="coiMaxPax"]')).toHaveValue("12");
    await expect(page.locator('textarea[name="notes"]')).toHaveValue(
      "Twin diesels, both replaced 2024.",
    );
  });

  test("locations: a refused save keeps you on the create form and keeps your typing", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await seedOneLocation(page);

    await page.goto("/admin/locations?sel=new");
    await expect.poll(() => isHydrated(page.locator('input[name="name"]'))).toBe(true);
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
    await expect.poll(() => isHydrated(page.locator('input[name="label"]'))).toBe(true);
    await page.fill('input[name="label"]', "Sunset Charcuterie");
    await page.fill('input[name="amount"]', "forty five"); // text input, so this reaches the server
    // Both checkboxes moved off their defaults, so a remount is visible in them too: `required`
    // defaults off and `active` defaults ON for a new add-on. `setCheckedHydrated`, not
    // `.check()` — these are controlled now, and a tick that beats hydration is reverted the
    // moment React mounts and asserts its own state over the DOM.
    await setCheckedHydrated(page.locator('input[name="required"]'), true);
    await setCheckedHydrated(page.locator('input[name="active"]'), false);

    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("The amount must be a dollar figure", { exact: false })).toBeVisible();

    await expect(page.getByRole("heading", { name: "New add-on" })).toBeVisible();
    await expect(page.locator('input[name="label"]')).not.toHaveValue("Existing Cooler of Ice");

    await expect(page.locator('input[name="label"]')).toHaveValue("Sunset Charcuterie");
    await expect(page.locator('input[name="amount"]')).toHaveValue("forty five");
    await expect(page.locator('input[name="required"]')).toBeChecked();
    await expect(page.locator('input[name="active"]')).not.toBeChecked();
  });
});
