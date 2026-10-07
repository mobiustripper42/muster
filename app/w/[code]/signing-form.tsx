import { birthYearOptions, MAX_CHILDREN } from "@core/checkin/signing.js";
import type { WaiverTemplate } from "@core/checkin/entities.js";
import { SubmitButton } from "../../../components/ui/submit-button";
import { UnsavedGuard } from "../../../components/ui/unsaved-guard";
import { ESIGN_CONSENT_LINE, ESIGN_CONSENT_TEXT } from "../../lib/esign-consent";
import type { FormDraft } from "../../lib/form-draft";
import { signWaiver } from "./actions";
import { ChildCards } from "./child-cards";
import { DateOfBirth, type DobParts } from "./date-of-birth";
import { Checkbox } from "../../../components/ui/choice";
import { Field } from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";
import { Card, Well } from "../../../components/ui/card";
import { Notice } from "../../../components/ui/notice";

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
        <Notice role="alert" as="p" tone="bad">
          {error}
        </Notice>
      )}

      <Card as="section" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Your details</h1>
          <p className="text-sm text-muted">You must be {ageOfMajority} or older to sign.</p>
        </div>
        <Field label="Full legal name" htmlFor="sign-name">
          <Input id="sign-name" name="name" required maxLength={100} autoComplete="name" defaultValue={draft?.get("name") ?? ""} className="w-full" />
        </Field>
        <Checkbox name="legalName" value="yes" required defaultChecked={draft?.has("legalName") ?? false}>
          <span>I certify that this is my full legal name</span>
        </Checkbox>
        <DateOfBirth
          names={ADULT_DOB}
          years={adultYears}
          defaults={{ month: draft?.get("dobMonth") ?? "", day: draft?.get("dobDay") ?? "", year: draft?.get("dobYear") ?? "" }}
          label="Date of birth"
        />
        <Field label="Email" htmlFor="sign-email">
          <Input id="sign-email" name="email" type="email" required autoComplete="email" inputMode="email" defaultValue={draft?.get("email") ?? ""} className="w-full" />
        </Field>
        <Field label="Phone (optional)" htmlFor="sign-phone">
          <Input id="sign-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={draft?.get("phone") ?? ""} className="w-full" />
        </Field>
      </Card>

      <ChildCards
        initial={childCardsFrom(draft)}
        max={MAX_CHILDREN}
        years={childYears}
        ageOfMajority={ageOfMajority}
      />

      <Card as="section" className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">The agreement</h2>
        {/* In page flow — no scroll-to-bottom gate (§A1). Shown as written, line breaks kept. */}
        <Well className="whitespace-pre-wrap break-words text-sm text-ink">
          {template.body}
        </Well>
        <Checkbox name="consent" value="yes" required defaultChecked={draft?.has("consent") ?? false}>
          <span>{ESIGN_CONSENT_LINE}</span>
        </Checkbox>
        {/* Outside the label, so opening it never ticks the box. Works with no JS. */}
        <details className="text-sm">
          <summary className="min-h-[44px] text-accent">What does this mean?</summary>
          <p className="mt-1 text-muted">{ESIGN_CONSENT_TEXT}</p>
        </details>
        <SubmitButton className="btn-primary min-h-[52px] w-full">Sign</SubmitButton>
      </Card>
    </form>
  );
}
