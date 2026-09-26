import { SubmitButton } from "../ui/submit-button";
import { setEnginePaused } from "../../app/(admin)/admin/actions";

/**
 * The engine pause/resume control (#124, DEC-054). Server-rendered, no client JS (DEC-026):
 * the button posts the desired next state to `setEnginePaused`.
 *
 * Extracted from the `/admin` hub (#603) so the Settings surface can host it. It stays a
 * component rather than moving wholesale, because the state carries its own alarm styling —
 * a red card reading "No asks fire automatically" — and that is the only ambient signal
 * anywhere that automation is off. Filing it behind a dropdown removes it from view; keeping
 * the component reusable is what lets a status chip render the same truth elsewhere later.
 */
export function EngineControl({ paused }: { paused: boolean | null }) {
  if (paused === null) {
    return (
      <div className="rounded-card border border-line bg-card px-4 py-3">
        <p className="text-sm text-muted">Engine status unavailable — couldn’t reach the database.</p>
      </div>
    );
  }
  // State carries its own color — green when running, red when paused — so the
  // card itself is the status signal (no separate top-of-page notice).
  const tone = paused
    ? { card: "border-bad-line bg-bad-bg", text: "text-bad", msg: "No asks fire automatically" }
    : { card: "border-ok-line bg-ok-bg", text: "text-ok", msg: "Automation fires asks" };
  return (
    <div className={`flex items-center justify-between gap-3 rounded-card border px-4 py-4 shadow-sm ${tone.card}`}>
      <div className="flex flex-col gap-0.5">
        <span className={`font-semibold ${tone.text}`}>Engine: {paused ? "Paused" : "Running"}</span>
        <span className={`text-sm ${tone.text}`}>{tone.msg}</span>
      </div>
      <form action={setEnginePaused}>
        <input type="hidden" name="paused" value={String(!paused)} />
        {/* Kind = the state you'd switch TO: pausing commits to a loss (no automatic
            asks), resuming doesn't, so danger vs secondary rather than one look. */}
        <SubmitButton className={paused ? "btn-secondary shrink-0" : "btn-danger shrink-0"}>
          {paused ? "Resume staffing" : "Pause staffing"}
        </SubmitButton>
      </form>
    </div>
  );
}
