/**
 * Waiver versions and check-in settings (Phase 18.2, issue #1116) — the validated write doors
 * behind `/admin/waivers`. Framework-free, returning `{ ok }` results the server actions map to
 * copy, the `saveVesselAdmin` idiom.
 *
 * **When a version takes effect.** The operator picks a date, never a time (2026-09-29):
 * - **today** → the moment it is posted, so a typo fix replaces the morning's version at once;
 * - **a future day** → midnight at the start of that day, boat time;
 * - **a past day** → refused: a version cannot take effect before it existed.
 *
 * **A version locks when it takes effect** (`docs/design/check-in-and-waivers.md` §6). Before
 * then nobody can have signed it, so it is edited in place. Because a future version is always
 * midnight, two for one day would take effect at the same instant and "current" would be a coin
 * toss — so a future day holds one version, and the second is refused in favour of editing the
 * first. Two posted today never tie: each takes the moment it was posted.
 */
import { TENANT_TIMEZONE, vesselDateOf, zonedWallClockToInstant } from "../config/tenant.js";
import { asId, type WaiverTemplateId } from "../domain/ids.js";
import type { Repository } from "../ports/repository.js";
import type { WaiverTemplate } from "./entities.js";

export interface WaiverVersionInput {
  /** The label people see, e.g. `brewboat-2026-v2`. */
  version: string;
  body: string;
  /** `YYYY-MM-DD`, boat time. */
  effectiveDate: string;
}

export type WaiverVersionError =
  | "version_required"
  | "body_required"
  | "bad_date"
  | "date_in_past"
  | "date_taken";
export type WaiverEditError = WaiverVersionError | "not_found" | "locked";

export type WaiverSaveResult<E> = { ok: true; id: WaiverTemplateId } | { ok: false; code: E };

interface Clock {
  /** ISO-8601 UTC. */
  now: string;
  /** The admin posting or editing. */
  by: string;
  tz?: string;
}

/** Has this version taken effect by `now`? From that instant it may carry signatures. */
export const isLocked = (t: WaiverTemplate, now: string): boolean => t.effectiveFrom <= now;

/** The boat-local day a version takes effect on. */
export const effectiveDateOf = (t: WaiverTemplate, tz: string = TENANT_TIMEZONE): string =>
  vesselDateOf(new Date(t.effectiveFrom), tz);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in `YYYY-MM-DD` — `2026-02-30` is not one. */
function isRealDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  const d = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/**
 * Validate the shared fields and work out the effective instant. `except` is the version being
 * edited, which may keep its own day.
 */
async function resolve(
  repo: Repository,
  input: WaiverVersionInput,
  { now, tz = TENANT_TIMEZONE }: Clock,
  except?: WaiverTemplateId,
): Promise<{ ok: true; version: string; body: string; effectiveFrom: string } | { ok: false; code: WaiverVersionError }> {
  const version = input.version.trim();
  if (!version) return { ok: false, code: "version_required" };
  const body = input.body.trim();
  if (!body) return { ok: false, code: "body_required" };

  const date = input.effectiveDate.trim();
  if (!isRealDate(date)) return { ok: false, code: "bad_date" };
  const today = vesselDateOf(new Date(now), tz);
  if (date < today) return { ok: false, code: "date_in_past" };
  if (date === today) return { ok: true, version, body, effectiveFrom: now };

  const taken = (await repo.listWaiverTemplates()).some(
    (t) => t.id !== except && !isLocked(t, now) && effectiveDateOf(t, tz) === date,
  );
  if (taken) return { ok: false, code: "date_taken" };
  return { ok: true, version, body, effectiveFrom: zonedWallClockToInstant(date, "00:00", tz).toISOString() };
}

/** Post a new version under `ctx.id` (minted by the caller). */
export async function postWaiverVersion(
  repo: Repository,
  input: WaiverVersionInput,
  ctx: Clock & { id: string },
): Promise<WaiverSaveResult<WaiverVersionError>> {
  const r = await resolve(repo, input, ctx);
  if (!r.ok) return r;
  const id = asId<"WaiverTemplateId">(ctx.id);
  const stored = await repo.postWaiverTemplate({
    id,
    version: r.version,
    body: r.body,
    effectiveFrom: r.effectiveFrom,
    postedAt: ctx.now,
    postedBy: ctx.by,
  });
  // The check above read the list before writing; a post landing between the two is caught by
  // the store's one-version-per-instant rule (issue #1137).
  if (stored === "date_taken") return { ok: false, code: "date_taken" };
  return { ok: true, id };
}

/** Rewrite a version that has not taken effect yet; the editor becomes its poster. */
export async function editWaiverVersion(
  repo: Repository,
  rawId: string,
  input: WaiverVersionInput,
  ctx: Clock,
): Promise<WaiverSaveResult<WaiverEditError>> {
  const id = asId<"WaiverTemplateId">(rawId);
  const existing = await repo.getWaiverTemplate(id);
  if (!existing) return { ok: false, code: "not_found" };
  if (isLocked(existing, ctx.now)) return { ok: false, code: "locked" };

  const r = await resolve(repo, input, ctx, id);
  if (!r.ok) return r;
  const updated = await repo.updateWaiverTemplate(
    { id, version: r.version, body: r.body, effectiveFrom: r.effectiveFrom, postedAt: ctx.now, postedBy: ctx.by },
    ctx.now,
  );
  // `locked` here means it took effect between the read above and the write — the lock won.
  // `date_taken` means another version took the new instant in the same gap (issue #1137).
  if (updated === "updated") return { ok: true, id };
  return { ok: false, code: updated };
}

// ── Settings ────────────────────────────────────────────────────────────────

export type CheckInSettingsError = "bad_age" | "bad_reminder_days";

/**
 * Reminder days as typed — `7, 3, 1` or `7 3 1` — as whole days above zero, repeats dropped,
 * largest first. Blank is `[]` (no reminders). Null when any entry is not a whole day.
 */
export function parseReminderDays(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter((p) => p !== "");
  if (!parts.every((p) => /^\d+$/.test(p) && Number(p) > 0)) return null;
  return [...new Set(parts.map(Number))].sort((a, b) => b - a);
}

export async function saveCheckInSettings(
  repo: Repository,
  input: { ageOfMajority: number; reminderDays: string },
  now: string,
): Promise<{ ok: true } | { ok: false; code: CheckInSettingsError }> {
  if (!Number.isInteger(input.ageOfMajority) || input.ageOfMajority < 1) return { ok: false, code: "bad_age" };
  const days = parseReminderDays(input.reminderDays);
  if (!days) return { ok: false, code: "bad_reminder_days" };
  await repo.setCheckInConfig({ ageOfMajority: input.ageOfMajority, reminderDaysBefore: days }, now);
  return { ok: true };
}
