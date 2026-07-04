import type { SeatCardVM } from "./seat-card";

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

export function MiniButton({ label, title }: { label: string; title?: string }) {
  return (
    <button
      type="submit"
      title={title}
      className="rounded-full border border-line bg-card px-2.5 py-1 text-xs font-medium text-accent hover:border-accent"
    >
      {label}
    </button>
  );
}
