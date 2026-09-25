"use client";

import { money, type TipTier } from "./money";

/**
 * Tip your crew — required, no decline (DEC-124). Shared by the customer's checkout and the
 * operator's phone booking (16.1d, issue #1092).
 *
 * `inputName` adds a hidden input carrying the chosen tier, for a form that posts to a server
 * action. The tiles are buttons, so without it a plain post would carry no tip at all.
 */
export function TipTiles({
  tiers,
  selectedBps,
  onSelect,
  inputName,
}: {
  tiers: readonly TipTier[];
  selectedBps: number;
  onSelect: (bps: number) => void;
  inputName?: string;
}) {
  return (
    <div className="pt-5">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">
        Tip your crew <span className="font-normal normal-case text-muted">· required</span>
      </div>
      {inputName ? <input type="hidden" name={inputName} value={selectedBps} /> : null}
      <div className="grid grid-cols-3 gap-2">
        {tiers.map((t) => (
          <button
            key={t.bps}
            type="button"
            data-testid={`tip-${t.bps}`}
            aria-pressed={t.bps === selectedBps}
            onClick={() => onSelect(t.bps)}
            className={`rounded-xl border px-1 py-2.5 text-center ${
              t.bps === selectedBps ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-line bg-card"
            }`}
          >
            <span className="block text-[17px] font-bold">{t.bps / 100}%</span>
            <span className="block font-mono text-xs text-muted">{money(t.tipCents)}</span>
          </button>
        ))}
      </div>
      {/* One line, and it only normalizes. The competitor version justifies the tip with a
          list of crew duties — safety, cleanliness, supplies — which reads as "tip us or the
          boat is a shithole". The old line here ("100% goes to the crew — never taxed, never
          fee'd") was us talking to ourselves: `fee'd` isn't a word, and the tax treatment is
          an internal accounting fact, not something a guest asked. The heading already says
          who the tip is for. */}
      <div className="mt-2 text-xs text-muted">Gratuity is included for groups, like a restaurant or a limo.</div>
    </div>
  );
}
