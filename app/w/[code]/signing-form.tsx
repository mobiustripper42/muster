import { birthYearOptions, MAX_CHILDREN } from "@core/checkin/signing.js";
import type { WaiverTemplate } from "@core/checkin/entities.js";
import { SubmitButton } from "../../../components/ui/submit-button";
import { UnsavedGuard } from "../../../components/ui/unsaved-guard";
import { ESIGN_CONSENT_LINE, ESIGN_CONSENT_TEXT } from "../../lib/esign-consent";
import type { FormDraft } from "../../lib/form-draft";
import { signWaiver } from "./actions";
import { ChildCards } from "./child-cards";
import { DateOfBirth, type DobParts } from "./date-of-birth";
import { card, input } from "./form-look";

/**
 * The signing form (Phase 18.4): the guest's details, a card for each child they add, then the
 * agreement and Sign at the bottom — one page, so the document is still last (§A1), and there is
 * one form to keep if the connection drops.
 *
 * **It opens straight on the details.** Nobody is asked first who they are signing for or how many
 * kids: "+ Add a minor" under the details adds a card at a time (operator, 2026-10-01 — almost
 * every guest signs for themselves, and the questions were a step each in their way). The cards
 * are the `ChildCards` island; the rest is server-rendered and posts without JS (DEC-147).
 *
 * A refused submit comes back through the form-draft with every field as typed, the minor cards
 * included (§A5: never lose the input).
 */

const ADULT_DOB: DobParts = { month: "dobMonth", day: "dobDay", year: "dobYear" };

/** The child cards a refused or restored form comes back with, in order. */
function childCardsFrom(draft: FormDraft | null): ({ name: string } & DobParts)[] {
  if (!draft) return [];
  const [months, days, years] = [draft.all("childMonth"), draft.all("childDay"), draft.all("childYear")];
  return draft
    .all("childName")
    .slice(0, MAX_CHILDREN)
    .map((name, i) => ({ name, month: months[i] ?? "", day: days[i] ?? "", year: years[i] ?? "" }));
}

export function SigningFormView({
  code,
  party,
  template,
  ageOfMajority,
  today,
  draft,
  error,
}: {
  code: string;
  /** The raw `party` param, carried through so a refusal returns to the same party. */
  party: string | undefined;
  template: WaiverTemplate;
  ageOfMajority: number;
  /** Boat-local `YYYY-MM-DD`. */
  today: string;
  draft: FormDraft | null;
  error: string | null;
}) {
  const adultYears = birthYearOptions("adult", today, ageOfMajority);
  const childYears = birthYearOptions("child", today, ageOfMajority);

  return (
    <form action={signWaiver} className="flex flex-col gap-5">
      {/* Enter in any field means Sign. A form's Enter key presses its FIRST submit button, and
          "+ Add a minor" and Remove are submit buttons (so they work without JS): without this,
          Enter in the name field would add a minor. */}
      {/* eslint-disable-next-line no-restricted-syntax -- invisible Enter-key target; the visible Sign below is the SubmitButton */}
      <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
        Sign
      </button>
      <UnsavedGuard restored={draft !== null} />
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="party" value={party ?? ""} />
      {/* The version shown, so the row records the words the guest read (waiver_changed). */}
      <input type="hidden" name="templateId" value={template.id} />

      {error && (
        <p role="alert" className="rounded-card border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <section className={card}>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Your details</h1>
          <p className="text-sm text-muted">You must be {ageOfMajority} or older to sign.</p>
        </div>
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
        <DateOfBirth
          names={ADULT_DOB}
          years={adultYears}
          defaults={{ month: draft?.get("dobMonth") ?? "", day: draft?.get("dobDay") ?? "", year: draft?.get("dobYear") ?? "" }}
          label="Date of birth"
        />
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Email</span>
          <input name="email" type="email" required autoComplete="email" inputMode="email" defaultValue={draft?.get("email") ?? ""} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Phone (optional)</span>
          <input name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={draft?.get("phone") ?? ""} className={input} />
        </label>
      </section>

      <ChildCards
        initial={childCardsFrom(draft)}
        max={MAX_CHILDREN}
        years={childYears}
        ageOfMajority={ageOfMajority}
      />

      <section className={card}>
        <h2 className="text-lg font-semibold">The agreement</h2>
        {/* In page flow — no scroll-to-bottom gate (§A1). Shown as written, line breaks kept. */}
        <div className="whitespace-pre-wrap break-words rounded-card border border-line bg-bg p-3 text-sm text-ink">
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
