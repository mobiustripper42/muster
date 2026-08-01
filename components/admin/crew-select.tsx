"use client";

import { AutoSubmitSelect } from "./auto-submit-select";

/**
 * Crew filter `<select>` that navigates on change — no "Filter" button (#330 UX,
 * requested). The mechanism now lives in {@link AutoSubmitSelect}, extracted when the
 * time clock (#627) needed the same behaviour on two selects: this stays as the
 * all-shifts surface's named, pre-configured wrapper ("All crew" + `name="crew"`) so
 * that page reads the same as before.
 *
 * No-JS tradeoff, unchanged: without JS the crew filter can't apply (the preset chips
 * stay plain links) — acceptable on this desktop-first, JS-assumed admin surface
 * (DEC-042 amendment, 2026-07-14).
 */
export function CrewSelect({
  crew,
  crewList,
  className,
}: {
  crew: string | null;
  crewList: { id: string; name: string }[];
  className?: string;
}) {
  return (
    <AutoSubmitSelect
      name="crew"
      value={crew ?? ""}
      includeEmpty="All crew"
      options={crewList.map((c) => ({ value: c.id, label: c.name }))}
      className={className}
      ariaLabel="Crew"
    />
  );
}
