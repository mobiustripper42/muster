import type { SeatCardVM } from "./seat-card";
import { SubmitButton } from "../ui/submit-button";

/** Shared form primitives for the cockpit's no-client-JS action forms. */

export function HiddenIds({ vm, crewId }: { vm: SeatCardVM; crewId?: string }) {
  return (
    <>
      <input type="hidden" name="shiftId" value={vm.shiftId} />
      <input type="hidden" name="seatId" value={vm.seatId} />
      {crewId !== undefined && (
        <input type="hidden" name="crewMemberId" value={crewId} />
      )}
      {/* Host context (DEC-085): present ⇒ the action redirects back to the
          board pane; "" is a real value (default window). Absent ⇒ standalone. */}
      {vm.ctx !== null && <input type="hidden" name="ctx" value={vm.ctx} />}
    </>
  );
}

export function MiniButton({
  label,
  title,
  glyph,
}: {
  label: string;
  title?: string;
  /** Decorative lead glyph (9.8) — aria-hidden; `label` stays the accessible name. */
  glyph?: string;
}) {
  // Folds into <SubmitButton> (DEC-089): every candidate-row Ask/Nudge gets the
  // pending spinner + disabled double-tap guard for free.
  return (
    <SubmitButton
      title={title}
      className="min-h-9 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-accent hover:border-accent"
    >
      {glyph && <span aria-hidden="true">{glyph} </span>}
      {label}
    </SubmitButton>
  );
}
