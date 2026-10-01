import { MAX_CHILDREN, type SigningPath } from "@core/checkin/signing.js";
import { AppLink } from "../../../components/ui/app-link";
import { CopyButton } from "../../../components/ui/copy-button";

/**
 * The short steps of the signing page (Phase 18.4, `docs/design/check-in-surfaces.md` §A): who,
 * which party, how many kids — each a list of links, so the page works with no client JS (DEC-147)
 * — and the success screen. The details-and-agreement form is `signing-form.tsx`.
 */

export interface StepState {
  code: string;
  path?: SigningPath | undefined;
  party?: string | undefined;
  kids?: number | undefined;
  /** Refill the form from the draft — set on the way back from a refused party (bad_party). */
  restore?: boolean | undefined;
}

/** The page address for a step. The trip code is always the canonical one. */
export function stepHref(s: StepState): string {
  const q = new URLSearchParams();
  if (s.path) q.set("for", s.path);
  if (s.party) q.set("party", s.party);
  if (s.kids) q.set("kids", String(s.kids));
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

function Back({ href }: { href: string }) {
  return (
    <AppLink href={href} className="mt-6 inline-flex min-h-[44px] items-center text-sm text-accent">
      ‹ Back
    </AppLink>
  );
}

/** Step 1 — who the guest is signing for. Labelled with ages from the operator's setting (§A1). */
export function WhoStep({ code, ageOfMajority }: { code: string; ageOfMajority: number }) {
  const options: { path: SigningPath; label: string; sub: string }[] = [
    { path: "me", label: `Myself (${ageOfMajority}+)`, sub: "Just you" },
    { path: "kids", label: "Me + my kids", sub: "You, and children coming with you" },
    { path: "child", label: `A child (under ${ageOfMajority})`, sub: "You sign for them as their parent or guardian" },
  ];
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Who are you signing for?</h1>
      <div className="flex flex-col gap-3">
        {options.map((o) => (
          <AppLink key={o.path} href={stepHref({ code, path: o.path })} className={choice} spinner="overlay">
            <span className={choiceRow}>
              <span className="flex flex-col">
                <span className="font-medium">{o.label}</span>
                <span className="text-sm text-muted">{o.sub}</span>
              </span>
              <span aria-hidden>›</span>
            </span>
          </AppLink>
        ))}
      </div>
    </>
  );
}

/** §A2 — only on a departure with more than one booking. Surnames only, scoped to this trip. */
export function PartyStep({
  code,
  path,
  kids,
  parties,
  refused,
}: {
  code: string;
  path: SigningPath;
  /** Carried through when the guest is sent back here mid-form, so they land on the form again. */
  kids?: number | undefined;
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
          <AppLink key={p.reservationId} href={stepHref({ code, path, kids, party: p.reservationId, restore: refused })} className={choice} spinner="overlay">
            <span className={choiceRow}>
              <span>
                {p.surname} · party of {p.partySize}
              </span>
              <span aria-hidden>›</span>
            </span>
          </AppLink>
        ))}
        <AppLink href={stepHref({ code, path, kids, party: "walkup", restore: refused })} className={choice} spinner="overlay">
          <span className={choiceRow}>
            <span>I’m a walk-up</span>
            <span aria-hidden>›</span>
          </span>
        </AppLink>
      </div>
      <Back href={stepHref({ code })} />
    </>
  );
}

/** Step 2 — how many kids, declared before the form so the ten cap is visible (§A1). */
export function KidsStep({ state, backHref }: { state: StepState; backHref: string }) {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">How many kids?</h1>
      <p className="mb-4 text-sm text-muted">Up to {MAX_CHILDREN} on one signature.</p>
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: MAX_CHILDREN }, (_, i) => i + 1).map((n) => (
          <AppLink
            key={n}
            href={stepHref({ ...state, kids: n })}
            spinner="overlay"
            className="relative flex min-h-[56px] items-center justify-center rounded-card border border-line bg-card text-lg font-medium text-ink shadow-sm"
          >
            {n}
          </AppLink>
        ))}
      </div>
      <Back href={backHref} />
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
