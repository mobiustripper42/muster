/**
 * Waiver versions and check-in settings (Phase 18.2, issue #1116) — the rules behind
 * `/admin/waivers`. The page is thin; everything that can be refused is refused here.
 *
 * Clock: 2026-09-29 14:14 in New York (18:14 UTC, EDT = UTC−4).
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import type { WaiverTemplate } from "./entities.js";
import { CHECK_IN_CONFIG_DEFAULTS } from "./entities.js";
import {
  editWaiverVersion,
  parseReminderDays,
  postWaiverVersion,
  saveCheckInSettings,
} from "./waiver-admin.js";

const TZ = "America/New_York";
const NOW = "2026-09-29T18:14:00.000Z";
const ADMIN = "crew-eric";

const post = (
  repo: InMemoryRepository,
  over: Partial<{ version: string; body: string; effectiveDate: string }> = {},
  ctx: Partial<{ id: string; now: string; by: string }> = {},
) =>
  postWaiverVersion(
    repo,
    { version: "brewboat-2026-v1", body: "I accept the risks.", effectiveDate: "2026-09-29", ...over },
    { id: "wt-new", now: NOW, by: ADMIN, tz: TZ, ...ctx },
  );

const inForce = (over: Partial<WaiverTemplate> = {}): WaiverTemplate => ({
  id: asId<"WaiverTemplateId">("wt-live"),
  version: "brewboat-2026-v0",
  body: "Old words.",
  effectiveFrom: "2026-09-01T04:00:00.000Z",
  postedAt: "2026-08-30T12:00:00.000Z",
  postedBy: "crew-mike",
  ...over,
});

describe("posting a waiver version", () => {
  it("dated today, it takes effect the moment it is posted", async () => {
    const repo = new InMemoryRepository();
    expect(await post(repo)).toEqual({ ok: true, id: "wt-new" });
    expect(await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-new"))).toEqual({
      id: "wt-new",
      version: "brewboat-2026-v1",
      body: "I accept the risks.",
      effectiveFrom: NOW,
      postedAt: NOW,
      postedBy: ADMIN,
    });
    expect((await repo.getCurrentWaiverTemplate(NOW))?.id).toBe("wt-new");
  });

  it("a typo fix posted later the same day replaces the morning's version from that moment", async () => {
    const repo = new InMemoryRepository();
    await post(repo, {}, { id: "wt-morning", now: "2026-09-29T13:00:00.000Z" });
    await post(repo, { body: "I accept the risks, fixed." }, { id: "wt-fix" });
    expect((await repo.getCurrentWaiverTemplate("2026-09-29T15:00:00.000Z"))?.id).toBe("wt-morning");
    expect((await repo.getCurrentWaiverTemplate(NOW))?.id).toBe("wt-fix");
  });

  it("dated in the future, it takes effect at midnight at the start of that day, boat time", async () => {
    const repo = new InMemoryRepository();
    await post(repo, { effectiveDate: "2026-10-05" });
    expect((await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-new")))?.effectiveFrom).toBe(
      "2026-10-05T04:00:00.000Z",
    );
    expect(await repo.getCurrentWaiverTemplate(NOW)).toBeNull();
  });

  it("reads 'today' in the boat's timezone, not UTC", async () => {
    // 22:00 on the 29th in New York is already the 30th in UTC.
    const lateEvening = "2026-09-30T02:00:00.000Z";
    const repo = new InMemoryRepository();
    expect(await post(repo, { effectiveDate: "2026-09-29" }, { now: lateEvening })).toEqual({ ok: true, id: "wt-new" });
    expect((await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-new")))?.effectiveFrom).toBe(lateEvening);

    const r2 = await post(repo, { effectiveDate: "2026-09-30" }, { id: "wt-tomorrow", now: lateEvening });
    expect(r2).toEqual({ ok: true, id: "wt-tomorrow" });
    expect((await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-tomorrow")))?.effectiveFrom).toBe(
      "2026-09-30T04:00:00.000Z",
    );
  });

  it("refuses a past date", async () => {
    const repo = new InMemoryRepository();
    expect(await post(repo, { effectiveDate: "2026-09-28" })).toEqual({ ok: false, code: "date_in_past" });
    expect(await repo.listWaiverTemplates()).toEqual([]);
  });

  it.each(["", "2026-13-40", "next tuesday", "2026-9-30"])("refuses a date that is not a date (%j)", async (d) => {
    expect(await post(new InMemoryRepository(), { effectiveDate: d })).toEqual({ ok: false, code: "bad_date" });
  });

  it("needs a label and text, and trims both", async () => {
    const repo = new InMemoryRepository();
    expect(await post(repo, { version: "   " })).toEqual({ ok: false, code: "version_required" });
    expect(await post(repo, { body: " \n " })).toEqual({ ok: false, code: "body_required" });
    await post(repo, { version: "  v2 ", body: "\nWords.\n\n" });
    const saved = await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-new"));
    expect([saved?.version, saved?.body]).toEqual(["v2", "Words."]);
  });

  it("allows one version per future day — a second for the same day is refused", async () => {
    const repo = new InMemoryRepository();
    await post(repo, { effectiveDate: "2026-10-05" }, { id: "wt-a" });
    expect(await post(repo, { effectiveDate: "2026-10-05" }, { id: "wt-b" })).toEqual({
      ok: false,
      code: "date_taken",
    });
    expect(await post(repo, { effectiveDate: "2026-10-06" }, { id: "wt-c" })).toEqual({ ok: true, id: "wt-c" });
  });

  it("a post that passes the check but loses the race at the store is still refused (issue #1137)", async () => {
    // The racer's up-front check read the list before the winner's row landed; the store says no.
    const repo = new InMemoryRepository();
    await post(repo, { effectiveDate: "2026-10-05" }, { id: "wt-a" });
    repo.listWaiverTemplates = () => Promise.resolve([]);
    expect(await post(repo, { effectiveDate: "2026-10-05" }, { id: "wt-b" })).toEqual({
      ok: false,
      code: "date_taken",
    });
    expect(await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-b"))).toBeNull();
  });
});

describe("editing a waiver version", () => {
  const edit = (
    repo: InMemoryRepository,
    id: string,
    over: Partial<{ version: string; body: string; effectiveDate: string }> = {},
    now = NOW,
  ) =>
    editWaiverVersion(
      repo,
      id,
      { version: "brewboat-2026-v2", body: "New words.", effectiveDate: "2026-10-05", ...over },
      { now, by: "crew-dana", tz: TZ },
    );

  it("rewrites a version that has not taken effect yet, in place, restamping who posted it and when", async () => {
    const repo = new InMemoryRepository();
    await post(repo, { effectiveDate: "2026-10-05" }, { now: "2026-09-28T12:00:00.000Z" });
    expect(await edit(repo, "wt-new", { effectiveDate: "2026-10-07" })).toEqual({ ok: true, id: "wt-new" });
    expect(await repo.listWaiverTemplates()).toEqual([
      {
        id: "wt-new",
        version: "brewboat-2026-v2",
        body: "New words.",
        effectiveFrom: "2026-10-07T04:00:00.000Z",
        postedAt: NOW,
        postedBy: "crew-dana",
      },
    ]);
  });

  it("moved to today, it takes effect at once", async () => {
    const repo = new InMemoryRepository();
    await post(repo, { effectiveDate: "2026-10-05" });
    await edit(repo, "wt-new", { effectiveDate: "2026-09-29" });
    expect((await repo.getCurrentWaiverTemplate(NOW))?.id).toBe("wt-new");
  });

  it("refuses a version that has taken effect — someone may have signed it", async () => {
    const repo = new InMemoryRepository();
    await repo.postWaiverTemplate(inForce());
    expect(await edit(repo, "wt-live")).toEqual({ ok: false, code: "locked" });
    expect(await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-live"))).toEqual(inForce());
  });

  it("locks at the exact moment it takes effect", async () => {
    const repo = new InMemoryRepository();
    await post(repo, { effectiveDate: "2026-10-05" });
    expect(await edit(repo, "wt-new", {}, "2026-10-05T04:00:00.000Z")).toEqual({ ok: false, code: "locked" });
  });

  it("refuses an unknown version", async () => {
    expect(await edit(new InMemoryRepository(), "wt-nope")).toEqual({ ok: false, code: "not_found" });
  });

  it("can keep its own day, but not move onto another future version's day", async () => {
    const repo = new InMemoryRepository();
    await post(repo, { effectiveDate: "2026-10-05" }, { id: "wt-a" });
    await post(repo, { effectiveDate: "2026-10-06" }, { id: "wt-b" });
    expect(await edit(repo, "wt-a", { effectiveDate: "2026-10-05" })).toEqual({ ok: true, id: "wt-a" });
    expect(await edit(repo, "wt-a", { effectiveDate: "2026-10-06" })).toEqual({ ok: false, code: "date_taken" });
  });

  it("an edit that passes the check but loses the race at the store is refused, not an error (issue #1137)", async () => {
    const repo = new InMemoryRepository();
    await post(repo, { effectiveDate: "2026-10-05" }, { id: "wt-a" });
    await post(repo, { effectiveDate: "2026-10-06" }, { id: "wt-b" });
    repo.listWaiverTemplates = () => Promise.resolve([]);
    expect(await edit(repo, "wt-a", { effectiveDate: "2026-10-06" })).toEqual({ ok: false, code: "date_taken" });
    expect((await repo.getWaiverTemplate(asId<"WaiverTemplateId">("wt-a")))?.effectiveFrom).toBe(
      "2026-10-05T04:00:00.000Z",
    );
  });

  it("applies the same checks as posting", async () => {
    const repo = new InMemoryRepository();
    await post(repo, { effectiveDate: "2026-10-05" });
    expect(await edit(repo, "wt-new", { effectiveDate: "2026-09-28" })).toEqual({ ok: false, code: "date_in_past" });
    expect(await edit(repo, "wt-new", { version: "" })).toEqual({ ok: false, code: "version_required" });
    expect(await edit(repo, "wt-new", { body: "" })).toEqual({ ok: false, code: "body_required" });
    expect(await edit(repo, "wt-new", { effectiveDate: "soon" })).toEqual({ ok: false, code: "bad_date" });
  });
});

describe("check-in settings", () => {
  it("saves the age of majority and the reminder days", async () => {
    const repo = new InMemoryRepository();
    expect(await saveCheckInSettings(repo, { ageOfMajority: 21, reminderDays: "5, 2" }, NOW)).toEqual({ ok: true });
    expect(await repo.getCheckInConfig()).toEqual({ ageOfMajority: 21, reminderDaysBefore: [5, 2] });
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses an age of majority that is not a whole number above zero (%s)", async (age) => {
    const repo = new InMemoryRepository();
    expect(await saveCheckInSettings(repo, { ageOfMajority: age, reminderDays: "7" }, NOW)).toEqual({
      ok: false,
      code: "bad_age",
    });
    expect(await repo.getCheckInConfig()).toEqual(CHECK_IN_CONFIG_DEFAULTS);
  });

  it.each(["7, x", "0", "-2", "2.5", "1e1"])("refuses reminder days that are not whole days (%j)", async (text) => {
    const repo = new InMemoryRepository();
    expect(await saveCheckInSettings(repo, { ageOfMajority: 18, reminderDays: text }, NOW)).toEqual({
      ok: false,
      code: "bad_reminder_days",
    });
    expect(await repo.getCheckInConfig()).toEqual(CHECK_IN_CONFIG_DEFAULTS);
  });

  it("reads reminder days separated by commas or spaces, drops repeats, largest first", () => {
    expect(parseReminderDays("1 3 7 3")).toEqual([7, 3, 1]);
    expect(parseReminderDays(" 7,3 , 1 ")).toEqual([7, 3, 1]);
    expect(parseReminderDays("3,,1")).toEqual([3, 1]);
  });

  it("an empty list means no reminders", async () => {
    const repo = new InMemoryRepository();
    expect(await saveCheckInSettings(repo, { ageOfMajority: 18, reminderDays: "  " }, NOW)).toEqual({ ok: true });
    expect((await repo.getCheckInConfig()).reminderDaysBefore).toEqual([]);
  });
});
