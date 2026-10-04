import { CopyButton } from "../ui/copy-button";
import { CrewMenuModal } from "./crew-menu-modal";
import { TripQr } from "./trip-qr";

/**
 * The check-in QR sheet (Phase 18.5b; surfaces §C2, §C3): **QR** opens a half-sheet with the
 * departure's signing code and "Scan to sign — BrewBoat 3:00 PM", and under it **Copy link** (18.7)
 * with the link as text. The guest scans with their own phone; behind the sheet, the list picks up
 * their name on its next re-read.
 *
 * **A `<details>`, so it opens and closes with no JS** — the crew drawer's pattern (`crew-menu.tsx`).
 * Open, the summary moves to the foot of the screen and reads **Done**, so the way out is always on
 * top of the sheet — centred and no wider than the sheet, which keeps to the app's column (operator,
 * 2026-10-02: it ran off the right edge). `CrewMenuModal` adds Escape, tap-outside and an inert page behind.
 *
 * **One element, whatever the state.** With nobody signed, the same summary is simply bigger (§C3:
 * the QR button is the biggest thing on the screen). Two elements would swap when the first signer
 * arrives on a re-read, and React would rebuild the sheet shut in the next guest's face.
 *
 * Must render as a direct child of `<main>`: everything else in main is "behind" it.
 *
 * No brightness control: a web page cannot set it (operator, 2026-10-02 — that waits for an app).
 */
export function TripQrSheet({
  url,
  label,
  big,
}: {
  /** The departure's `/w/<code>` link; null when it could not be made — the sheet says so. */
  url: string | null;
  /** "BrewBoat 3:00 PM". */
  label: string;
  /** Nobody has signed yet: the button is the biggest thing on the screen. */
  big: boolean;
}) {
  return (
    <details
      data-qr-sheet
      className="group open:before:fixed open:before:inset-0 open:before:z-30 open:before:bg-ink/40 open:before:content-['']"
    >
      <summary
        className={`${big ? "btn-primary min-h-[120px] text-2xl" : "btn-secondary min-h-[52px] text-base"} relative z-50 flex w-full list-none items-center justify-center gap-2 font-semibold group-open:fixed group-open:bottom-4 group-open:left-1/2 group-open:w-[calc(100%-2rem)] group-open:max-w-[26rem] group-open:-translate-x-1/2 group-open:min-h-[52px] group-open:text-base [&::-webkit-details-marker]:hidden`}
      >
        <span className="group-open:hidden">{big ? "Show the QR to sign" : "QR · scan to sign"}</span>
        <span className="hidden group-open:inline">Done</span>
      </summary>
      <div
        data-qr-sheet-panel
        role="dialog"
        aria-modal="true"
        aria-label="Scan to sign"
        className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-md flex-col items-center gap-4 rounded-t-card bg-white px-6 pb-24 pt-6 text-center"
      >
        {url ? (
          <TripQr url={url} className="w-full max-w-[320px]" />
        ) : (
          <p className="py-10 text-sm text-muted">The code didn’t load. Close this and open check-in again.</p>
        )}
        <p className="text-lg font-semibold text-ink">Scan to sign — {label}</p>
        {url && (
          // For a guest whose phone won't scan, or a booker who texts the mate for the link (18.7):
          // the same link as the code, to paste or read out.
          <div className="flex w-full flex-col items-center gap-1">
            <CopyButton value={url} label="Copy link" className="btn-secondary min-h-[44px] w-full max-w-[320px]" />
            <p data-testid="qr-sheet-link" className="max-w-full select-all break-all text-xs text-muted">
              {url}
            </p>
          </div>
        )}
      </div>
      <CrewMenuModal name="qr-sheet" />
    </details>
  );
}
