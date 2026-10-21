/**
 * Every label's `for` names a field (issue #1194).
 *
 * A `<label for>` naming an id that isn't on the page, or that sits on something that can't be
 * labelled, renders fine and does nothing: the click doesn't focus the field and a screen reader
 * announces it unnamed. `expectLabelsResolve` (`e2e/label-check.ts`) is the check.
 *
 *   - AC3 proves the helper both ways on `page.setContent` fixtures — it fails naming the
 *     dangling `for`, and passes when every one resolves.
 *   - AC4 runs it on every route that renders a `<Field>` (`grep -rln "<Field" app`), each reached
 *     the way its own spec reaches it: same seed, same sign-in, the same steps to open the form.
 *
 * Each AC4 visit first waits for a field the page's form renders, so a page that came up signed
 * out or empty fails here rather than passing with nothing to check. Desktop only.
 */
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  clickHydrated,
  plantBookedReservation,
  plantTripLink,
  plantVesselBlock,
  plantWaiverTemplate,
  resetAndSeed,
  signInAsAdmin,
  signInAsCrew,
} from "./fixtures.js";
import { expectLabelsResolve } from "./label-check.js";
import { BOOKED, DEMO, OPEN_TIME, demoReservationId } from "./reservation-demo.js";

/** One label for each labelable element the HTML standard names, plus a non-text input. */
const ALL_LABELABLE = `
  <label for="f-input">Input</label><input id="f-input">
  <label for="f-check">Check</label><input id="f-check" type="checkbox">
  <label for="f-select">Select</label><select id="f-select"><option>One</option></select>
  <label for="f-textarea">Textarea</label><textarea id="f-textarea"></textarea>
  <label for="f-button">Button</label><button id="f-button" type="button">Go</button>
  <label for="f-meter">Meter</label><meter id="f-meter" value="0.5"></meter>
  <label for="f-output">Output</label><output id="f-output">1</output>
  <label for="f-progress">Progress</label><progress id="f-progress" value="1" max="2"></progress>
  <label>Wrapping, no for <input name="wrapped"></label>
`;

test.describe("AC3: expectLabelsResolve", () => {
  test("AC3: passes when every label's for names a labelable element", async ({ page }) => {
    await page.setContent(`<main>${ALL_LABELABLE}</main>`);
    await expectLabelsResolve(page);
  });

  // The bad label goes LAST, after eight good ones, so a check that only reads the first label
  // passes it and fails here.
  test("AC3: fails, naming the for, when it names an id that is not on the page", async ({ page }) => {
    await page.setContent(`<main>${ALL_LABELABLE}<label for="no-such-field">Gone</label></main>`);
    await expect(expectLabelsResolve(page)).rejects.toThrow(/no-such-field/);
  });

  test("AC3: fails, naming the for, when it names an element that cannot be labelled", async ({ page }) => {
    await page.setContent(
      `<main>${ALL_LABELABLE}<label for="just-a-div">Not a field</label><div id="just-a-div"></div></main>`,
    );
    await expect(expectLabelsResolve(page)).rejects.toThrow(/just-a-div/);
  });

  test("AC3: fails, naming the for, when it names a hidden input", async ({ page }) => {
    await page.setContent(
      `<main>${ALL_LABELABLE}<label for="hidden-one">Hidden</label><input type="hidden" id="hidden-one" name="h"></main>`,
    );
    await expect(expectLabelsResolve(page)).rejects.toThrow(/hidden-one/);
  });
});

/** Open `url`, wait for a field its form renders, then check every label on the page. */
async function labelsResolveAt(page: Page, url: string, field: (p: Page) => Locator): Promise<void> {
  await page.goto(url);
  await expectFormThenCheck(page, field(page), url);
}

async function expectFormThenCheck(page: Page, field: Locator, where: string): Promise<void> {
  await expect(field, `${where} rendered its form`).toBeAttached();
  await expectLabelsResolve(page);
}

test.describe("AC4: every <Field> route's labels resolve", () => {
  // ── Admin settings lists (the crew seed: vessel-hops, nothing else) ──────────────────────────
  // `e2e/add-ons.spec.ts`, `e2e/vessel-location-admin.spec.ts`.

  test("AC4: /admin/add-ons, new and with one selected", async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsAdmin(page, "eric");
    await labelsResolveAt(page, "/admin/add-ons?sel=new", (p) => p.locator('input[name="label"]'));

    await page.fill('input[name="label"]', "Extra hour");
    await page.fill('input[name="amount"]', "150.00");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);
    await page.goto("/admin/add-ons");
    await expect(page.locator('input[name="label"]')).toHaveValue("Extra hour");
    await expectLabelsResolve(page);
  });

  test("AC4: /admin/locations, new and with one selected", async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsAdmin(page, "eric");
    await labelsResolveAt(page, "/admin/locations?sel=new", (p) => p.locator('input[name="name"]'));

    await page.fill('input[name="name"]', "East Bank");
    await page.fill('textarea[name="pickupDescription"]', "Flats East Bank, dock 3");
    await page.fill('textarea[name="routeDescription"]', "Up the river and back");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(/saved=1/);
    await page.goto("/admin/locations");
    await expect(page.locator('input[name="name"]')).toHaveValue("East Bank");
    await expectLabelsResolve(page);
  });

  test("AC4: /admin/vessels, new and with one selected", async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsAdmin(page, "eric");
    await labelsResolveAt(page, "/admin/vessels?sel=new", (p) => p.locator('input[name="coiMaxPax"]'));
    await labelsResolveAt(page, "/admin/vessels?sel=vessel-hops", (p) => p.locator('input[name="coiMaxPax"]'));
  });

  // ── Admin crew pages — `e2e/admin-time-clock.spec.ts`, `e2e/time-off.spec.ts` ─────────────────

  test("AC4: /admin/time-clock, by crew and by day", async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsAdmin(page, "eric");
    await labelsResolveAt(page, "/admin/time-clock", (p) => p.locator("#add-day"));
    await labelsResolveAt(page, "/admin/time-clock?day=2026-07-04", (p) => p.locator("#day"));
  });

  test("AC4: /admin/time-off", async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsAdmin(page, "eric");
    await labelsResolveAt(page, "/admin/time-off", (p) => p.locator("#crewMemberId"));
  });

  // ── Admin pages on the reservation seed — `e2e/offering-catalog.spec.ts` creates its own
  // offering on the crew seed; the reservation seed already carries one to select. ─────────────

  test("AC4: /admin/offerings, new and with one selected", async ({ page }) => {
    await resetAndSeed("reservation");
    await signInAsAdmin(page, "eric");
    await labelsResolveAt(page, "/admin/offerings?sel=new", (p) => p.locator('input[name="name"]'));
    await page.goto(`/admin/offerings?sel=${encodeURIComponent("offering-reservation-demo")}`);
    await expect(page.locator('input[name="name"]')).toHaveValue("Reservation Demo Cruise");
    await expectLabelsResolve(page);
  });

  // `e2e/blocks.spec.ts`. The page has no `sel=new`: a block is created from the question on the
  // bare page, so the editor's fields are reached by selecting one. Both scoped kinds are selected,
  // a boat out and a closure, because editing one swaps its picker for plain text.
  test("AC4: /admin/blocks, bare and with a boat block and a closure selected", async ({ page }) => {
    await resetAndSeed("reservation");
    await plantVesselBlock({
      id: "blk-label-check",
      vesselId: DEMO.vesselId,
      startDate: DEMO.vesselBlockWindow.start,
      endDate: DEMO.vesselBlockWindow.end,
    });
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/blocks");
    await expect(page.getByText("What’s happening?")).toBeVisible();
    await expectLabelsResolve(page);
    await labelsResolveAt(page, "/admin/blocks?sel=blk-label-check", (p) => p.locator("#blk-from"));

    // A closure, made the way `e2e/blocks.spec.ts` makes one; saving lands on it selected.
    await page.goto("/admin/blocks");
    await clickHydrated(page.getByRole("button", { name: /A dock or the river is closed/ }));
    await page.getByLabel("Which location").selectOption({ label: "Reservation Demo Dock" });
    await page.getByLabel("Date", { exact: true }).fill(DEMO.locationBlockWindow.date);
    await page.getByLabel("From", { exact: true }).fill("13:00");
    await page.getByLabel("To", { exact: true }).fill("16:00");
    await page.getByRole("button", { name: "Block it", exact: true }).click();
    await page.waitForURL(/sel=/);
    await expectFormThenCheck(page, page.locator("#blk-date"), "/admin/blocks with a closure selected");
  });

  // `e2e/phone-booking.spec.ts`: the `<Field>`s are in the booking pane, which opens on an open
  // slot with `book=1` — passengers first, then the checkout step once a party is set.
  test("AC4: /admin/calendar, both booking-pane steps and a reservation selected", async ({ page }) => {
    await resetAndSeed("reservation");
    await signInAsAdmin(page, "eric");
    const book = `/admin/calendar?date=${BOOKED.date}&hold=${encodeURIComponent(`${DEMO.vesselId}|${OPEN_TIME}`)}&book=1`;
    await labelsResolveAt(page, book, (p) => p.getByTestId("book-pane").getByLabel("Guests"));
    await labelsResolveAt(page, `${book}&guests=2`, (p) => p.getByPlaceholder("Guest’s full name"));
    await labelsResolveAt(
      page,
      `/admin/calendar/${encodeURIComponent(demoReservationId(BOOKED.date, BOOKED.time))}?date=${BOOKED.date}`,
      (p) => p.getByTestId("reservation-detail"),
    );
  });

  // `e2e/waiver-admin.spec.ts` — no seed beyond the operator.
  test("AC4: /admin/waivers", async ({ page }) => {
    await resetAndSeed();
    await signInAsAdmin(page, "eric");
    await labelsResolveAt(page, "/admin/waivers", (p) => p.locator('input[name="version"]'));
  });

  // ── Public ───────────────────────────────────────────────────────────────────────────────────

  // `e2e/book-find.spec.ts`.
  test("AC4: /b/find", async ({ page }) => {
    await resetAndSeed("reservation");
    await labelsResolveAt(page, "/b/find", (p) => p.locator("#find-contact"));
  });

  // `e2e/signing.spec.ts`: a private charter with a waiver posted, and one minor added on the phone.
  test("AC4: /w/<code>, with one minor added", async ({ page }) => {
    await resetAndSeed("crew");
    const code = "K3F9QZ2M";
    await plantTripLink({ code, date: "2030-06-01", time: "15:00" });
    await plantBookedReservation({
      id: "resv-smith",
      eventId: `evt-trip-${code}`,
      customerName: "Carol Smith",
      partySize: 4,
    });
    await plantWaiverTemplate({
      id: "wt-live",
      version: "brewboat-2026-v1",
      body: "Voyage Agreement\n\nI accept the risks of a boat trip.",
      effectiveFrom: "2026-01-01T05:00:00.000Z",
    });
    await labelsResolveAt(page, `/w/${code}`, (p) => p.getByLabel("Full legal name").first());
    await clickHydrated(page.getByRole("button", { name: "+ Add a minor" }));
    await expectFormThenCheck(page, page.locator('input[name="childName"]').first(), "/w/<code> with a minor");
  });

  // ── Crew (the crew seed, Quint) ────────────────────────────────────────────────────────────

  // `e2e/crew-sign-in.spec.ts`: signed out, then the code step after asking for a code.
  test("AC4: /crew, signed out and at the code step", async ({ page }) => {
    await resetAndSeed("crew");
    await labelsResolveAt(page, "/crew", (p) => p.getByLabel(/sign in with your crew email/i));
    await page.getByLabel(/sign in with your crew email/i).fill("quint@bb.test");
    await page.getByRole("button", { name: /email me a code/i }).click();
    await page.waitForURL(/stage=code/);
    await expectFormThenCheck(page, page.getByLabel(/enter your code/i), "/crew?stage=code");
  });

  // `e2e/calendar-feed.spec.ts`: the field holds a link just made, shown once.
  test("AC4: /crew/calendar, with a link just made", async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/calendar");
    await page.getByRole("button", { name: /create my calendar link/i }).click();
    await expectFormThenCheck(page, page.locator("#feed-url"), "/crew/calendar");
  });

  // `e2e/crew-open.spec.ts`.
  test("AC4: /crew/open", async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsCrew(page, "crew-quint");
    await labelsResolveAt(page, "/crew/open", (p) => p.locator("#open-from"));
  });

  // `e2e/crew-time.spec.ts`: the punch form opens with `?add=1`.
  test("AC4: /crew/time, adding a punch", async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsCrew(page, "crew-quint");
    await labelsResolveAt(page, "/crew/time?add=1", (p) => p.locator("#new-day"));
  });

  // `e2e/days-off.spec.ts`.
  test("AC4: /crew/time-off", async ({ page }) => {
    await resetAndSeed("crew");
    await signInAsCrew(page, "crew-quint");
    await labelsResolveAt(page, "/crew/time-off", (p) => p.locator("#start"));
  });
});
