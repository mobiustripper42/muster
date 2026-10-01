import { birthYearOptions, type SigningPath } from "@core/checkin/signing.js";
import type { WaiverTemplate } from "@core/checkin/entities.js";
import { SubmitButton } from "../../../components/ui/submit-button";
import { UnsavedGuard } from "../../../components/ui/unsaved-guard";
import { ESIGN_CONSENT_LINE, ESIGN_CONSENT_TEXT } from "../../lib/esign-consent";
import type { FormDraft } from "../../lib/form-draft";
import { signWaiver } from "./actions";

/**
 * The details and the agreement, on one page (Phase 18.4; operator's choice B, 2026-09-30): the
 * guest's details first, the agreement below, and Sign at the bottom — so the document is still
 * last (§A1), and there is one form to keep if the connection drops, not two.
 *
 * No client JS needed (DEC-147). A refused submit comes back through the form-draft with every
 * field as typed (§A5: never lose the input).
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const input = "min-h-[48px] w-full rounded-card border border-line bg-bg px-3 text-ink";
const select = "min-h-[48px] rounded-card border border-line bg-bg px-2 text-ink";

function DateOfBirth({
  prefix,
  years,
  draft,
  label,
}: {
  /** `dob` for the adult, `child{i}` for a child block. */
  prefix: { month: string; day: string; year: string };
  years: number[];
  draft: FormDraft | null;
  label: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm text-muted">{label}</legend>
      <div className="grid grid-cols-[1.4fr_1fr_1.1fr] gap-2">
        <select name={prefix.month} required aria-label={`${label}: month`} defaultValue={draft?.get(prefix.month) ?? ""} className={select}>
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select name={prefix.day} required aria-label={`${label}: day`} defaultValue={draft?.get(prefix.day) ?? ""} className={select}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select name={prefix.year} required aria-label={`${label}: year`} defaultValue={draft?.get(prefix.year) ?? ""} className={select}>
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}

function kidsHeadingFor(path: SigningPath, kids: number): string {
  if (path !== "child") return "Your kids";
  return kids === 1 ? "Your child" : "Your children";
}

export function SigningFormView({
  code,
  path,
  party,
  kids,
  template,
  ageOfMajority,
  today,
  draft,
  error,
}: {
  code: string;
  path: SigningPath;
  /** The raw `party` param, carried through so a refusal returns to the same step. */
  party: string | undefined;
  kids: number;
  template: WaiverTemplate;
  ageOfMajority: number;
  /** Boat-local `YYYY-MM-DD`. */
  today: string;
  draft: FormDraft | null;
  error: string | null;
}) {
  const adultYears = birthYearOptions("adult", today, ageOfMajority);
  const childYears = birthYearOptions("child", today, ageOfMajority);
  const heading = path === "child" ? "Your details (parent or guardian)" : "Your details";
  const kidsHeading = kidsHeadingFor(path, kids);

  return (
    <form action={signWaiver} className="flex flex-col gap-5">
      <UnsavedGuard restored={draft !== null} />
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="for" value={path} />
      <input type="hidden" name="party" value={party ?? ""} />
      <input type="hidden" name="kids" value={path === "me" ? "" : String(kids)} />
      {/* The version shown, so the row records the words the guest read (waiver_changed). */}
      <input type="hidden" name="templateId" value={template.id} />

      {error && (
        <p role="alert" className="rounded-card border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{heading}</h1>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Full legal name</span>
          <input name="name" required maxLength={100} autoComplete="name" defaultValue={draft?.get("name") ?? ""} className={input} />
        </label>
        <label className="flex min-h-[44px] items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            name="legalName"
            value="yes"
            required
            defaultChecked={draft?.has("legalName") ?? false}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>I certify that this is my full legal name</span>
        </label>
        <DateOfBirth prefix={{ month: "dobMonth", day: "dobDay", year: "dobYear" }} years={adultYears} draft={draft} label="Date of birth" />
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Email</span>
          <input name="email" type="email" required autoComplete="email" inputMode="email" defaultValue={draft?.get("email") ?? ""} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Phone (optional)</span>
          <input name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={draft?.get("phone") ?? ""} className={input} />
        </label>
      </section>

      {path !== "me" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{kidsHeading}</h2>
          {Array.from({ length: kids }, (_, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-card border border-line bg-card p-3">
              <p className="text-sm font-medium text-ink">Child {i + 1}</p>
              <label className="flex flex-col gap-1">
                <span className="text-sm text-muted">Child’s full name</span>
                <input name={`childName${i}`} required maxLength={100} defaultValue={draft?.get(`childName${i}`) ?? ""} className={input} />
              </label>
              <DateOfBirth
                prefix={{ month: `childMonth${i}`, day: `childDay${i}`, year: `childYear${i}` }}
                years={childYears}
                draft={draft}
                label={`Child ${i + 1}’s date of birth`}
              />
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">The agreement</h2>
        {/* In page flow — no scroll-to-bottom gate (§A1). Shown as written, line breaks kept. */}
        <div className="whitespace-pre-wrap break-words rounded-card border border-line bg-card p-3 text-sm text-ink">
          {template.body}
        </div>
        <label className="flex min-h-[44px] items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            name="consent"
            value="yes"
            required
            defaultChecked={draft?.has("consent") ?? false}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>{ESIGN_CONSENT_LINE}</span>
        </label>
        {/* Outside the label, so opening it never ticks the box. Works with no JS. */}
        <details className="text-sm">
          <summary className="min-h-[44px] text-accent">What does this mean?</summary>
          <p className="mt-1 text-muted">{ESIGN_CONSENT_TEXT}</p>
        </details>
        <SubmitButton className="btn-primary min-h-[52px] w-full">Sign</SubmitButton>
      </section>
    </form>
  );
}
