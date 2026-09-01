import type { ChangeBanner } from "@core/crewapp/shift-changes.js";
import { shiftStartHHmm } from "@core/adapters/change-summary.js";
import { fmt12, fmtRunWhen } from "../../app/lib/format";
import { SubmitButton } from "../ui/submit-button";

/**
 * "This shift changed" — what moved since this crew member last looked (#769, DEC-158).
 *
 * The SMS half of #740 is a **strict subset** by design: shortest true tokens, one GSM-7 segment,
 * the rest dropped. This is the surface that half assumes exists. Until it did, the fallback text
 * (`your Sat, Jul 4 - Barrel shift changed.`) pointed at a card that showed the shift but not
 * what changed about it.
 *
 * **"Shift Start", not "Call time".** The issue's mock says call time; the codebase deliberately
 * does not. `src/adapters/change-summary.ts` records the operator's call from 2026-08-17 —
 * *nobody outside the trade knows what a call time is* — and the shift card labels this exact
 * value "Shift Start" two inches below this banner. Two names for one number on one screen is
 * worse than either name.
 *
 * **A row renders only when the record can substantiate it.** Both pairs arrive `null` when the
 * value is unknown or did not move, and each row is gated on its own pair. A shift written before
 * the `earliest_start` watermark has no prior start, and absent is unknown — not "changed".
 *
 * **No JS.** A plain form post, so the dismiss works on a phone with a bad connection mid-render
 * (DEC-147: server-rendered by default, and this needs nothing an island would buy).
 */
export function ChangeBanner({
  banner,
  shiftId,
  dismiss,
}: {
  banner: ChangeBanner;
  shiftId: string;
  dismiss: (fd: FormData) => Promise<void>;
}) {
  const startMoved = banner.startBefore !== null && banner.startAfter !== null;
  const tripsMoved = banner.tripsBefore !== null && banner.tripsAfter !== null;

  return (
    <section
      data-testid="change-banner"
      className="flex flex-col gap-3 rounded-card border border-accent bg-card px-4 py-4 shadow-sm"
    >
      {/* One sentence, never a count (#766). It used to read "changed twice" / "changed N times"
          off a row count, which two overlapping re-forms could inflate — one change recorded
          twice said "twice". The rows below are what the crew member acts on; how many writes it
          took to get there is our bookkeeping, not their information. */}
      <h2 className="text-sm font-semibold text-ink">This shift changed</h2>

      {/* Nothing to itemise happens: a one-for-one trip swap moves the manifest without moving
          the count or the earliest departure, so both pairs net out. The banner still belongs on
          screen — something changed — it just cannot name what without inventing it. */}
      {!startMoved && !tripsMoved && (
        <p className="text-sm text-muted">
          Open the trips below to see what’s different.
        </p>
      )}

      <dl className="flex flex-col gap-1.5">
        {startMoved && (
          <Row
            label="Shift Start"
            before={fmt12(shiftStartHHmm(banner.startBefore!))}
            after={fmt12(shiftStartHHmm(banner.startAfter!))}
          />
        )}
        {tripsMoved && (
          <Row label="Trips" before={String(banner.tripsBefore)} after={String(banner.tripsAfter)} />
        )}
      </dl>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          Changed {fmtRunWhen(banner.latestAt)}
        </span>
        <form action={dismiss}>
          <input type="hidden" name="shiftId" value={shiftId} />
          {/* 44px minimum — this is a phone surface and the button sits beside a timestamp. */}
          <SubmitButton className="min-h-[44px] rounded-card bg-accent px-4 text-sm font-semibold text-white">
            Got it
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}

/**
 * One `before → after` line.
 *
 * `flex-wrap` rather than a fixed two-column grid: at 375px "Shift Start" plus two spelled-out
 * meridiem times is close to the full width, and a grid would either truncate the label or push
 * the arrow off-screen. Wrapping puts the pair on its own line instead, which stays readable.
 */
function Row({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="flex items-baseline gap-2 font-mono text-sm text-ink">
        <span className="text-muted line-through">{before}</span>
        <span aria-hidden>→</span>
        <span className="font-semibold">{after}</span>
      </dd>
    </div>
  );
}
