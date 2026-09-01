/**
 * The crew app shows what changed, dismissible per person (#769, DEC-158 Decision 4).
 *
 * The SMS half of #740 shipped first and is a **strict subset** by design — shortest true tokens,
 * one GSM-7 segment, the rest dropped. That is only safe if the app carries all of it, and until
 * this landed it did not: the fallback text pointed at a card that showed the shift but not what
 * changed about it. The SMS was making a promise the app did not keep.
 *
 * Every test here drives the real surface with a planted change record, because the four things
 * worth pinning are all properties of the rendered page and the stored pair of tables:
 * what it says, who it clears for, whether a later change brings it back, and — the one a fold
 * test cannot reach — whether it refuses to describe what it cannot substantiate.
 */
import {
  expect,
  plantShiftChange,
  resetAndSeed,
  signInAsCrew,
  test,
} from "./fixtures.js";

/** Quint's confirmed seat on `shift-soon` — the pair every other crew spec drives. */
const SHIFT = "shift-soon";
const QUINT = "crew-quint";
const HOOPER = "crew-hooper";

/** 3:30 PM → 2:00 PM departures. The banner shows the SHIFT START, 45 minutes earlier. */
const DEPARTED_1530 = "2026-07-04T19:30:00.000Z";
const DEPARTED_1400 = "2026-07-04T18:00:00.000Z";

test.describe("what changed on this shift (#769)", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("names what moved, in the crew's own vocabulary", async ({ page }) => {
    await plantShiftChange({
      shiftId: SHIFT,
      crewMemberId: QUINT,
      changedAt: "2026-07-04T14:00:00.000Z",
      startBefore: DEPARTED_1530,
      startAfter: DEPARTED_1400,
    });

    await signInAsCrew(page, QUINT);
    await page.goto(`/crew/shift/${SHIFT}`);

    const banner = page.getByTestId("change-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("This shift changed");
    // **"Shift Start", not "Call time".** The operator's call, 2026-08-17: nobody outside the
    // trade knows what a call time is. The shift card labels this exact value "Shift Start" a
    // few inches below, and two names for one number on one screen is worse than either.
    await expect(banner).toContainText("Shift Start");
    await expect(banner).not.toContainText("Call time");
    // Departure minus the 45-minute lead, spelled out — the app has room the SMS does not.
    await expect(banner).toContainText("2:45 PM");
    await expect(banner).toContainText("1:15 PM");
  });

  test("describes everything since you last looked, as one story", async ({ page }) => {
    // Two hops before they opened it: 3:30 → 2:45 → 2:00. The banner reports the ENDPOINTS,
    // because that is what changed from their point of view. Reporting the newest hop alone
    // would describe a move they never saw the start of.
    await plantShiftChange({
      shiftId: SHIFT,
      crewMemberId: QUINT,
      changedAt: "2026-07-04T14:00:00.000Z",
      startBefore: DEPARTED_1530,
      startAfter: "2026-07-04T18:45:00.000Z",
    });
    await plantShiftChange({
      shiftId: SHIFT,
      crewMemberId: QUINT,
      changedAt: "2026-07-04T15:00:00.000Z",
      startBefore: "2026-07-04T18:45:00.000Z",
      startAfter: DEPARTED_1400,
    });

    await signInAsCrew(page, QUINT);
    await page.goto(`/crew/shift/${SHIFT}`);

    const banner = page.getByTestId("change-banner");
    // Asserted as an ABSENCE, because the positive version has no discriminating power:
    // `toContainText("This shift changed")` is a substring match that passes against "This shift
    // changed twice" too, so it would not notice the count coming back. Two records in this
    // window is exactly the case that used to render it (#766).
    await expect(banner).not.toContainText("changed twice");
    await expect(banner).toContainText("2:45 PM");
    await expect(banner).toContainText("1:15 PM");
    // The intermediate hop is not a thing they were ever shown — it must not appear.
    await expect(banner).not.toContainText("2:00 PM");
  });

  test("claims nothing it cannot substantiate", async ({ page }) => {
    // A shift row written before the `earliest_start` watermark has no prior start. Absent is
    // UNKNOWN, not "changed" — so the banner raises (something moved) with no Shift Start row,
    // exactly as the SMS refuses to name a clock change it cannot support.
    await plantShiftChange({
      shiftId: SHIFT,
      crewMemberId: QUINT,
      changedAt: "2026-07-04T14:00:00.000Z",
      startBefore: null,
      startAfter: DEPARTED_1400,
    });

    await signInAsCrew(page, QUINT);
    await page.goto(`/crew/shift/${SHIFT}`);

    const banner = page.getByTestId("change-banner");
    await expect(banner).toBeVisible();
    await expect(banner).not.toContainText("Shift Start");
  });

  test("Got it clears it, and a later change brings it back", async ({ page }) => {
    await plantShiftChange({
      shiftId: SHIFT,
      crewMemberId: QUINT,
      changedAt: "2026-07-04T14:00:00.000Z",
      startBefore: DEPARTED_1530,
      startAfter: DEPARTED_1400,
    });

    await signInAsCrew(page, QUINT);
    await page.goto(`/crew/shift/${SHIFT}`);
    await expect(page.getByTestId("change-banner")).toBeVisible();

    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByTestId("change-banner")).toBeHidden();

    // The abort path this issue calls out as the one worth testing: dismissing must not be
    // permanent. Re-raise is `changed_at > last_seen_at` and nothing else, so a change landing
    // after the dismissal comes back on its own — no flag anyone has to remember to reset.
    // A dismissal implemented by DELETING the change rows would pass every line above and fail
    // exactly here.
    await plantShiftChange({
      shiftId: SHIFT,
      crewMemberId: QUINT,
      changedAt: new Date(Date.now() + 60_000).toISOString(),
      startBefore: DEPARTED_1400,
      startAfter: DEPARTED_1530,
    });

    await page.reload();
    await expect(page.getByTestId("change-banner")).toBeVisible();
  });

  test("one crew member dismissing does not clear it for the other", async ({ page }) => {
    // "Seen" is not a property of the shift (DEC-158). A read marker keyed on shift alone would
    // pass every other test in this file and fail this one.
    const at = "2026-07-04T14:00:00.000Z";
    for (const crewMemberId of [QUINT, HOOPER]) {
      await plantShiftChange({
        shiftId: SHIFT,
        crewMemberId,
        changedAt: at,
        startBefore: DEPARTED_1530,
        startAfter: DEPARTED_1400,
      });
    }

    await signInAsCrew(page, QUINT);
    await page.goto(`/crew/shift/${SHIFT}`);
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByTestId("change-banner")).toBeHidden();

    await signInAsCrew(page, HOOPER);
    await page.goto(`/crew/shift/${SHIFT}`);
    await expect(page.getByTestId("change-banner")).toBeVisible();
  });

  test("My shifts flags the row, and the flag clears with the banner", async ({ page }) => {
    await plantShiftChange({
      shiftId: SHIFT,
      crewMemberId: QUINT,
      changedAt: "2026-07-04T14:00:00.000Z",
      startBefore: DEPARTED_1530,
      startAfter: DEPARTED_1400,
    });

    await signInAsCrew(page, QUINT);
    // A flag in the list, the story on the card — a five-line banner per row would push the
    // list itself off a 375px screen.
    await expect(page.getByTestId("changed-pill")).toBeVisible();

    await page.goto(`/crew/shift/${SHIFT}`);
    await page.getByRole("button", { name: "Got it" }).click();

    await page.goto("/crew");
    await expect(page.getByTestId("changed-pill")).toBeHidden();
  });
});
