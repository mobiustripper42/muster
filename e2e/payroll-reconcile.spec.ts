/**
 * Payroll reconcile + the Gusto file (13.4, #628) — the deliverable the whole phase exists for.
 *
 * Drives the real doors rather than seeding rows: a crew member clocks in (which is what creates
 * an OPEN punch), the operator sees the export refused because of it, closes it on the repair
 * bench, and only then can the file be built. The arithmetic is unit-tested
 * (`src/admin/time-clock-report.test.ts`, `payroll-reconcile.test.ts`); this is the surface and
 * the gate.
 */
import {
  test,
  expect,
  clickHydrated,
  resetAndSeed,
  selectOptionHydrated,
  signInAsCrew,
  signInAsAdmin,
} from "./fixtures.js";

/** The pay period containing today — what `/admin/payroll` opens on. */
async function currentPeriodValue(page: import("@playwright/test").Page): Promise<string> {
  const opts = await page
    .locator("#period option")
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const found = opts.find((v) => {
    const [s, e] = v.split("|");
    return s! <= today && today <= e!;
  });
  if (!found) throw new Error(`no pay period contains ${today}`);
  return found;
}

test.describe("admin /admin/payroll — estimate vs actual, and the export gate", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew");
  });

  test("an open punch blocks the file, and closing it releases the export", async ({
    page,
    context,
  }) => {
    // ── A crew member goes on the clock: one open punch in the current period ──
    await signInAsCrew(page, "crew-quint");
    await page.goto("/crew/time");
    await page.getByRole("button", { name: "Clock in" }).click();
    await page.waitForURL(/in=1/);

    // ── The operator opens payroll and cannot download ────────────────────────
    const admin = await context.browser()!.newPage();
    await signInAsAdmin(admin, "eric");
    await admin.goto("/admin/payroll");
    await expect(admin.getByRole("heading", { name: "Payroll hours" })).toBeVisible();

    const period = await currentPeriodValue(admin);

    // The block, and WHY — plus a way to fix it. A refusal with no route out is a dead end.
    await expect(admin.getByText(/still on the clock/i)).toBeVisible();
    await expect(admin.getByRole("link", { name: "Download Gusto CSV" })).toHaveCount(0);
    await expect(admin.getByText("Export unavailable")).toBeVisible();
    const fix = admin.getByRole("link", { name: "Quint", exact: true });
    await expect(fix).toBeVisible();
    expect(await fix.getAttribute("href")).toContain("/admin/time-clock?crew=crew-quint");

    // ── The URL is refused too, not just the button ───────────────────────────
    // A bookmark and a back button both outlive a hidden control; the file must not exist.
    const blocked = await admin.request.get(
      `/admin/payroll/gusto.csv?period=${encodeURIComponent(period)}`,
    );
    expect(blocked.status()).toBe(409);
    // Still asserts the REASON, not just the 409 — the message is reason-specific since #645
    // (it can now also name an overlap), and a generic assertion would pass for either.
    expect(await blocked.text()).toMatch(/still open/i);

    // ── Close it the way a human would, on the repair bench ───────────────────
    await page.goto("/crew/time");
    await page.getByRole("button", { name: "Clock out" }).click();
    await page.waitForURL(/out=1/);

    // ── Now the file builds, and carries hours ────────────────────────────────
    await admin.reload();
    await expect(admin.getByText("Export unavailable")).toHaveCount(0);
    const download = admin.getByRole("link", { name: "Download Gusto CSV" });
    await expect(download).toBeVisible();

    const csv = await admin.request.get(
      `/admin/payroll/gusto.csv?period=${encodeURIComponent(period)}`,
    );
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-disposition"]).toContain("gusto-payroll-");
    const body = await csv.text();
    // One file, both columns — the operator's call on 2026-08-02.
    expect(body.split("\n")[0]).toContain("regular_hours");
    expect(body.split("\n")[0]).toContain("paycheck_tips");

    await admin.close();
  });

  test("a scheduled crew member who never punched still gets a row, reading 0h", async ({
    page,
  }) => {
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/payroll");

    // The crew seed's confirmed shift is 15 days out, so the CURRENT period is empty — pick the
    // period that actually contains it, the same way payroll.spec.ts does.
    const soon = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(Date.now() + 15 * 24 * 3600 * 1000));
    const values = await page
      .locator("#period option")
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const target = values.find((v) => {
      const [s, e] = v.split("|");
      return s! <= soon && soon <= e!;
    })!;
    expect(target).toBeTruthy();
    await page.locator("#period").selectOption(target);
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.waitForURL(/period=/);

    await expect(page.getByRole("columnheader", { name: "Est." })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Actual" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Δ" })).toBeVisible();

    // Quint holds a Confirmed seat here and has clocked nothing. THIS is the row the union
    // exists for: an inner join would drop it and the file would be short a whole person with
    // nothing on screen to say so.
    const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Quint", exact: true }) });
    await expect(row).toContainText("4h 50m"); // the estimate
    await expect(row).toContainText("0h 0m"); // actual — never punched
    await expect(row.getByRole("link", { name: "Time clock" })).toBeVisible();
  });

  test("a missing punch is flagged and linked — and the file still builds", async ({ page }) => {
    // The #638 asymmetry, end to end. Quint's Confirmed seat with no punch is the SAME fixture
    // the test above uses; here it has to produce a named day, a link to that day's bench, and
    // — the part that matters — an export that still works. An open punch blocks because
    // closing it always clears the block; a missing day may simply be true, so gating on it
    // would stop payroll for everyone with nothing the operator could do to release it.
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/payroll");

    const soon = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(Date.now() + 15 * 24 * 3600 * 1000));
    const values = await page
      .locator("#period option")
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const target = values.find((v) => {
      const [s, e] = v.split("|");
      return s! <= soon && soon <= e!;
    })!;
    await page.locator("#period").selectOption(target);
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.waitForURL(/period=/);

    // Named, not just counted — "someone is short somewhere" is not actionable a fortnight on.
    await expect(page.getByText(/no punch against (it|them)/)).toBeVisible();

    // Scoped to Quint's own entry. The seed puts several people on that day, so the date link
    // is not unique on the page — asserting it globally passes for the wrong reason (someone
    // else's link) and would keep passing if Quint's row lost its own.
    const quintEntry = page.locator("li").filter({ hasText: "Quint" });
    await expect(quintEntry.getByRole("link", { name: soon })).toHaveAttribute(
      "href",
      `/admin/time-clock?day=${soon}`,
    );

    // NOT blocked. This is the assertion the whole decision rests on.
    await expect(page.getByRole("link", { name: "Download Gusto CSV" })).toBeVisible();
    await expect(page.getByText("Export unavailable")).toHaveCount(0);
  });

  test("#645: two overlapping punches block the export, entered the way it really happens", async ({
    page,
  }) => {
    // Driven through the admin bench rather than seeded, because hand entry is the ONLY way this
    // state can arise — `clockIn` cannot produce it (the one-open-punch index sees to that), so
    // seeding the rows directly would test the detector without testing the door that lets it in.
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/time-clock");

    // Previous period: every day in it is already past, so the no-future guard can't refuse the
    // out time. Day 1 of a period is today, and that is how admin-time-clock.spec.ts went red
    // one day in fourteen.
    const select = page.getByLabel("Pay period");
    const values = await select
      .locator("option")
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const i = values.indexOf(await select.inputValue());
    // `selectOptionHydrated` (#763): this select navigates from its `onChange`, so a selection
    // made before the handler attaches changes the value and goes nowhere — and the
    // `waitForURL` below then burns its full timeout on a navigation nobody asked for.
    await selectOptionHydrated(select, values[i - 1]!);
    await page.waitForURL(/period=/);
    const period = new URL(page.url()).searchParams.get("period")!;

    const day = await page.locator("#add-day").getAttribute("min");
    // Wait on the ROW COUNT, not on the URL. A successful add redirects to `${back}&added=1`
    // (`admin/time-clock/actions.ts:123`), so on the second pass `waitForURL(/added=1/)` matched
    // the URL the FIRST add had already left and returned instantly — the test never waited for
    // the second punch to be written, then navigated to payroll. Fast machines won that race;
    // CI on a slow runner did not, and it failed as "no overlap notice" with the CSV link still
    // present, which reads like a detector bug rather than a test that skipped a step.
    const cards = page.locator("[data-punch-row]");
    const before = await cards.count();
    for (const [i, [inAt, outAt]] of [["09:00", "17:00"], ["13:00", "18:00"]].entries()) {
      await page.locator("#add-day").fill(day!);
      await page.locator("#add-in").fill(inAt!);
      await page.locator("#add-out").fill(outAt!);
      await page.getByRole("button", { name: "Add" }).click();
      await expect(cards).toHaveCount(before + i + 1);
    }

    // Both punches were ACCEPTED — the domain does not refuse the write (#645 is a report
    // condition, not a write guard). The refusal happens at the file.
    await page.goto(`/admin/payroll?period=${encodeURIComponent(period)}`);
    await expect(page.getByText(/covering the same time/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Download Gusto CSV" })).toHaveCount(0);

    // And the route refuses directly, not just the button being hidden.
    const res = await page.request.get(
      `/admin/payroll/gusto.csv?period=${encodeURIComponent(period)}`,
    );
    expect(res.status()).toBe(409);
    // The message names THIS condition. "Close it on the time clock" would be wrong advice —
    // there is nothing open to close.
    expect(await res.text()).toMatch(/overlapping/i);
  });

  test("no horizontal overflow — six columns still fit the phone (375px)", async ({ page }, testInfo) => {
    // The reconcile table went from three columns to six (crew, est, actual, delta, tips, link).
    // The table itself scrolls inside `overflow-x-auto`; what must NOT happen is the PAGE
    // growing, which is how a wide table quietly breaks every other surface's layout on a phone.
    test.skip(testInfo.project.name !== "mobile", "375px is the case under test");
    await signInAsAdmin(page, "eric");
    await page.goto("/admin/payroll");
    await expect(page.getByRole("heading", { name: "Payroll hours" })).toBeVisible();
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(fits).toBe(true);
  });
});
