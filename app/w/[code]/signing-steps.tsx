import { AppLink } from "../../../components/ui/app-link";
import { CopyButton } from "../../../components/ui/copy-button";

/**
 * The signing page's screens around the form (Phase 18.4, `docs/design/check-in-surfaces.md` §A):
 * which party — a list of links, so it works with no client JS (DEC-147) — and the success screen.
 * The form is `signing-form.tsx`.
 */

export interface StepState {
  code: string;
  party?: string | undefined;
  /** Refill the form from the draft — set on the way back from a refused party (bad_party). */
  restore?: boolean | undefined;
}

/** The page address for a step. The trip code is always the canonical one. */
export function stepHref(s: StepState): string {
  const q = new URLSearchParams();
  if (s.party) q.set("party", s.party);
  if (s.restore) q.set("restore", "1");
  const qs = q.toString();
  return `/w/${s.code}${qs ? `?${qs}` : ""}`;
}

// A whole-row link: `spinner="overlay"` (AppLink's mode for a card or row) renders the children
// straight into the link — the default inline mode wraps them in a shrink-to-fit span, which pulled
// the › in beside the text — and spreads the loading spinner over the card, which is `relative`.
const choice =
  "relative flex min-h-[56px] w-full items-center rounded-card border border-line bg-card px-4 py-3 text-left text-ink shadow-sm";
const choiceRow = "flex w-full items-center justify-between gap-3";

/**
 * §A2 — before the form, only on a departure with more than one booking. Surnames only, scoped to
 * this trip.
 */
export function PartyStep({
  code,
  parties,
  refused,
}: {
  code: string;
  parties: { reservationId: string; surname: string; partySize: number }[];
  /** The party they picked was cancelled while they typed. Their details wait in the draft. */
  refused: boolean;
}) {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Who are you here with?</h1>
      {refused && <p className="mb-3 text-sm text-bad">Pick who you’re here with.</p>}
      <div className="flex flex-col gap-3">
        {parties.map((p) => (
          <AppLink key={p.reservationId} href={stepHref({ code, party: p.reservationId, restore: refused })} className={choice} spinner="overlay">
            <span className={choiceRow}>
              <span>
                {p.surname} · party of {p.partySize}
              </span>
              <span aria-hidden>›</span>
            </span>
          </AppLink>
        ))}
        <AppLink href={stepHref({ code, party: "walkup", restore: refused })} className={choice} spinner="overlay">
          <span className={choiceRow}>
            <span>I’m a walk-up</span>
            <span aria-hidden>›</span>
          </span>
        </AppLink>
      </div>
    </>
  );
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

function stillToSign(remaining: number): string {
  if (remaining === 0) return "Everyone in your group has signed.";
  if (remaining === 1) return "One person still needs to sign.";
  return `${WORDS[remaining] ?? remaining} people still need to sign.`;
}

/**
 * §A4 — the success screen. The group line shows only for a guest with a booking; a walk-up has
 * no group to count. Numbers come from `groupCoverage`, so they never pass the party size or the
 * boat's limit.
 */
export function SuccessView({
  firstName,
  coverage,
  shareUrl,
  code,
}: {
  firstName: string;
  coverage: { covered: number; of: number; remaining: number } | null;
  shareUrl: string;
  code: string;
}) {
  return (
    <>
      <p aria-hidden className="mb-2 text-3xl text-ok">
        ✓
      </p>
      <h1 className="mb-4 text-xl font-semibold">You’re all set, {firstName}</h1>
      {coverage && (
        <div className="mb-6 rounded-card border border-line bg-card px-4 py-3">
          <p className="font-medium text-ink">
            Your group: {coverage.covered} of {coverage.of} signed
          </p>
          <p className="text-sm text-muted">{stillToSign(coverage.remaining)}</p>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <CopyButton value={shareUrl} label="Share with your party" className="btn-primary min-h-[48px] w-full" />
        <p className="-mt-1 text-center text-xs text-muted">
          Copies the link to send your group: <span className="select-all break-all">{shareUrl}</span>
        </p>
        <AppLink href={stepHref({ code })} className="btn-secondary inline-flex min-h-[48px] w-full items-center justify-center">
          Sign for someone else
        </AppLink>
        <p className="-mt-1 text-center text-xs text-muted">A fresh form, on this phone</p>
      </div>
    </>
  );
}
