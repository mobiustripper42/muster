import type { ReactNode } from "react";

/**
 * A waiver version's words exactly as stored — line breaks kept, nothing rendered as markup. Shared
 * by `/admin/waivers` (18.2) and the departure page (18.8), so the operator reads the same text the
 * same way in both places: the words a guest accepted.
 */
export function WaiverVersionText({ version, body, meta }: { version: string; body: string; meta: string }) {
  return (
    <div className="flex flex-col gap-2 py-3">
      <p className="text-sm font-medium text-ink">{version}</p>
      <p className="text-xs text-muted">{meta}</p>
      <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words rounded-card border border-line bg-bg p-3 text-sm text-ink">
        {body}
      </div>
    </div>
  );
}

/**
 * A version folded away behind **Show text**. The summary is a flex row, which drops the browser's
 * own ▸ marker — so it says what a tap does and carries the house caret (`/crew/open`).
 */
export function WaiverVersionDisclosure({
  summary,
  version,
  body,
  meta,
}: {
  summary: ReactNode;
  version: string;
  body: string;
  meta: string;
}) {
  return (
    <details className="group">
      <summary className="flex min-h-[44px] items-center gap-3 text-sm text-ink [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">{summary}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-accent">
          <span className="group-open:hidden">Show text</span>
          <span className="hidden group-open:inline">Hide text</span>
          <span aria-hidden className="transition-transform group-open:rotate-90">
            ›
          </span>
        </span>
      </summary>
      <WaiverVersionText version={version} body={body} meta={meta} />
    </details>
  );
}
