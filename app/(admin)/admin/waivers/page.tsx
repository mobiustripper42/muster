import type { ReactNode } from "react";
import { TENANT_TIMEZONE, vesselDateOf } from "@core/config/tenant.js";
import type { CheckInConfig, WaiverTemplate } from "@core/checkin/entities.js";
import { effectiveDateOf, isLocked } from "@core/checkin/waiver-admin.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { UnsavedGuard } from "../../../../components/ui/unsaved-guard";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { WaiverVersionDisclosure, WaiverVersionText } from "../../../../components/admin/waiver-version";
import { Field } from "../../../../components/ui/field";
import { Input, Textarea } from "../../../../components/ui/input";
import { readSubject } from "../../../lib/auth";
import { errCopyFor } from "../../../lib/err-copy";
import { fmtRunWhen } from "../../../lib/format";
import { readFormDraft, type FormDraft } from "../../../lib/form-draft";
import { getRepo } from "../../../lib/repo";
import { ADMIN_LOG_HINT, logSwallowed } from "../../../lib/swallowed";
import { saveSettings, saveWaiverVersion, type SettingsErr, type WaiverErr } from "./actions";
import { Card, CardHeader } from "../../../../components/ui/card";

/**
 * /admin/waivers (Phase 18.2, issue #1116) — the waiver text guests agree to, and the module's
 * two settings. Spec: `docs/design/check-in-and-waivers.md` §6 and §10.
 *
 * **A version locks the moment it takes effect**, because from then on someone may have signed
 * it. So the page reads top to bottom as: what is in force (read-only), what is scheduled
 * (editable), the form, and the history (read-only). Fixing words in force is posting a new
 * version dated today — the form opens with the current text filled in, so that is an edit that
 * saves as a new row.
 *
 * Native forms, no client JS (DEC-147). Two forms share one draft cookie, so each carries a
 * hidden `form` field and a restored draft goes back only into the form it came from.
 */

export const dynamic = "force-dynamic";

type Search = { edit?: string; saved?: string; err?: string };

const WAIVER_COPY: Record<WaiverErr, string> = {
  version_required: "Give the version a label.",
  body_required: "The waiver text can’t be empty.",
  bad_date: "Pick the date it takes effect.",
  date_in_past: "Pick today or a later date — a version can’t take effect before it was posted.",
  date_taken: "A version is already scheduled for that day — edit that one instead.",
  not_found: "That version no longer exists.",
  locked: "That version has taken effect, so it can’t be changed — post a new version instead.",
  error: "Couldn’t save that just now — try again in a moment.",
};

const SETTINGS_COPY: Record<SettingsErr, string> = {
  bad_age: "Age of majority must be a whole number of years.",
  bad_reminder_days: "Reminder days must be whole numbers of days, like 7, 3, 1.",
  settings_error: "Couldn’t save the settings just now — try again in a moment.",
};

const SAVED_COPY: Record<string, string> = {
  posted: "Version posted.",
  edited: "Scheduled version saved.",
  settings: "Settings saved.",
};

/** "Oct 5, 2026" — the boat-local day a version takes effect. */
const fmtDay = (t: WaiverTemplate) =>
  new Date(`${effectiveDateOf(t)}T12:00:00.000Z`).toLocaleDateString("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  });

export default async function AdminWaivers({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  let versions: WaiverTemplate[];
  let config: CheckInConfig;
  let names: Map<string, string>;
  try {
    const repo = getRepo();
    const [v, c, admins] = await Promise.all([
      repo.listWaiverTemplates(),
      repo.getCheckInConfig(),
      repo.listAdmins(),
    ]);
    versions = v;
    config = c;
    names = new Map(admins.map((a) => [String(a.id), a.name]));
  } catch (e) {
    logSwallowed("admin/waivers", e, "the waiver versions and check-in settings did not load");
    return (
      <Shell width="3xl">
        <Notice>Couldn’t load the waivers right now. {ADMIN_LOG_HINT}</Notice>
      </Shell>
    );
  }

  const now = new Date().toISOString();
  const today = vesselDateOf(new Date(now), TENANT_TIMEZONE);
  // Newest effective first (the repository's order): the first locked one is in force.
  const scheduled = versions.filter((t) => !isLocked(t, now)).reverse();
  const inForce = versions.filter((t) => isLocked(t, now));
  const current = inForce[0] ?? null;
  const past = inForce.slice(1);
  const posterOf = (t: WaiverTemplate) => names.get(t.postedBy) ?? t.postedBy;

  const editing = sp.edit ? scheduled.find((t) => t.id === sp.edit) ?? null : null;
  const editMissing = sp.edit !== undefined && editing === null;

  const draft = sp.err ? await readFormDraft("/admin/waivers") : null;
  const versionDraft =
    draft?.get("form") === "version" && (draft.get("id") ?? "") === (editing?.id ?? "") ? draft : null;
  const settingsDraft = draft?.get("form") === "settings" ? draft : null;

  const waiverErr = errCopyFor(WAIVER_COPY, sp.err);
  const settingsErr = errCopyFor(SETTINGS_COPY, sp.err);
  const saved = sp.saved && Object.hasOwn(SAVED_COPY, sp.saved) ? SAVED_COPY[sp.saved] : null;

  return (
    <Shell width="3xl">
      <div className="flex flex-col gap-4">
        <header>
          <p className="text-xs text-muted">Setup / Waivers</p>
          <h1 className="text-[22px] font-semibold leading-tight text-ink">Waivers</h1>
        </header>

        {saved && <Notice tone="ok">{saved}</Notice>}
        {waiverErr && <Notice tone="bad">{waiverErr}</Notice>}
        {editMissing && (
          <Notice tone="bad">That version can’t be edited — it has taken effect or no longer exists.</Notice>
        )}

        <TitledCard title="In effect now">
          {current ? (
            <WaiverVersionText
              version={current.version}
              body={current.body}
              meta={`In effect since ${fmtRunWhen(current.effectiveFrom)} · posted by ${posterOf(current)}`}
            />
          ) : (
            <p className="py-2 text-sm text-muted">No waiver posted yet.</p>
          )}
        </TitledCard>

        {scheduled.length > 0 && (
          <TitledCard title="Scheduled">
            <ul className="flex flex-col divide-y divide-line">
              {scheduled.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{t.version}</p>
                    <p className="text-xs text-muted">
                      Takes effect {fmtDay(t)} · posted by {posterOf(t)}, {fmtRunWhen(t.postedAt)}
                    </p>
                  </div>
                  <AppLink
                    href={`/admin/waivers?edit=${encodeURIComponent(t.id)}#waiver-form`}
                    className="btn-secondary inline-flex min-h-[44px] items-center"
                  >
                    Edit
                  </AppLink>
                </li>
              ))}
            </ul>
          </TitledCard>
        )}

        <VersionForm
          editing={editing}
          current={current}
          today={today}
          draft={versionDraft}
        />

        {past.length > 0 && (
          <TitledCard title="Past versions">
            <ul className="flex flex-col divide-y divide-line">
              {past.map((t) => (
                <li key={t.id} className="py-2">
                  <WaiverVersionDisclosure
                    summary={
                      <>
                        {t.version}
                        <span className="ml-2 text-xs text-muted">from {fmtRunWhen(t.effectiveFrom)}</span>
                      </>
                    }
                    version={t.version}
                    body={t.body}
                    meta={`Posted by ${posterOf(t)}, ${fmtRunWhen(t.postedAt)}`}
                  />
                </li>
              ))}
            </ul>
          </TitledCard>
        )}

        <SettingsForm config={config} draft={settingsDraft} error={settingsErr} />
      </div>

      <VersionTag />
    </Shell>
  );
}

function TitledCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section" pad="none">
      <CardHeader title={title} />
      <div className="px-4 py-1">{children}</div>
    </Card>
  );
}

/**
 * Post a new version, or edit a scheduled one. A new version opens with the text in force filled
 * in, so fixing a typo is change-and-post. Defaults are `draft ?? record ?? blank` (#699).
 */
function VersionForm({
  editing,
  current,
  today,
  draft,
}: {
  editing: WaiverTemplate | null;
  current: WaiverTemplate | null;
  today: string;
  draft: FormDraft | null;
}) {
  const source = editing ?? current;
  return (
    <Card id="waiver-form" as="section" pad="none">
      <form key={editing?.id ?? "new"} action={saveWaiverVersion}>
        <UnsavedGuard restored={draft !== null} />
        <input type="hidden" name="form" value="version" />
        <input type="hidden" name="id" value={editing?.id ?? ""} />
        <CardHeader title={editing ? `Edit scheduled version` : "Post a new version"}>
          Dated today, it takes effect as soon as you post it. A later date takes effect at midnight
          that day, and can be edited until then. Once in effect, it can’t be changed.
        </CardHeader>
        <div className="px-4 py-1">
          <Field htmlFor="waiver-version" layout="row" label="Label" hint="e.g. brewboat-2026-v2">
            <Input
              id="waiver-version"
              name="version"
              required
              defaultValue={draft?.get("version") ?? editing?.version ?? ""}
              className="w-full max-w-[320px]"
            />
          </Field>
          <Field htmlFor="waiver-effective-date" layout="row" label="Takes effect">
            <Input
              id="waiver-effective-date"
              name="effectiveDate"
              type="date"
              required
              min={today}
              defaultValue={draft?.get("effectiveDate") ?? (editing ? effectiveDateOf(editing) : today)}
              className="max-w-[200px]"
            />
          </Field>
          <Field
            htmlFor="waiver-body"
            layout="row"
            label="Waiver text"
            hint="Exactly what guests agree to"
          >
            <Textarea
              id="waiver-body"
              name="body"
              required
              rows={14}
              // Edit lands in the words, not at the top of the page (operator, 2026-09-29) — a
              // typo fix is why you edit. Also scrolls it into view; `#waiver-form` is the fallback.
              autoFocus={editing !== null}
              defaultValue={draft?.get("body") ?? source?.body ?? ""}
              className="w-full"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
          <SubmitButton className="btn-primary min-h-[44px]">{editing ? "Save changes" : "Post version"}</SubmitButton>
          {editing && (
            <AppLink href="/admin/waivers" className="inline-flex min-h-[44px] items-center text-sm text-accent">
              Cancel
            </AppLink>
          )}
        </div>
      </form>
    </Card>
  );
}

function SettingsForm({
  config,
  draft,
  error,
}: {
  config: CheckInConfig;
  draft: FormDraft | null;
  error: string | null;
}) {
  return (
    <Card as="section" pad="none">
      <form action={saveSettings}>
        <UnsavedGuard restored={draft !== null} />
        <input type="hidden" name="form" value="settings" />
        <CardHeader title="Settings" />
        {error && (
          <div className="px-4 pt-3">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
        <div className="px-4 py-1">
          <Field
            htmlFor="waiver-age-of-majority"
            layout="row"
            label="Age of majority"
            hint="Younger guests sign with a parent or guardian"
          >
            <Input
              id="waiver-age-of-majority"
              name="ageOfMajority"
              type="number"
              min={1}
              step={1}
              required
              defaultValue={draft?.get("ageOfMajority") ?? config.ageOfMajority}
              className="max-w-[110px] font-mono"
            />
          </Field>
          <Field
            htmlFor="waiver-reminder-days"
            layout="row"
            label="Reminder days"
            hint="Days before the trip the booker is reminded"
          >
            <Input
              id="waiver-reminder-days"
              name="reminderDays"
              defaultValue={draft?.get("reminderDays") ?? config.reminderDaysBefore.join(", ")}
              placeholder="none"
              className="w-full max-w-[200px] font-mono"
            />
          </Field>
        </div>
        <div className="border-t border-line px-4 py-3">
          <SubmitButton className="btn-primary min-h-[44px]">Save settings</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
