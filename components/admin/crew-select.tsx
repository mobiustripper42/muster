"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Crew filter `<select>` that navigates on change — no "Filter" button (#330 UX,
 * requested). Mirrors `GetFormSubmit`'s soft `router.push` (the established filter-
 * form client island for this surface — a `<select onChange>` needs client JS, and
 * these forms already rely on it), reading the enclosing form's hidden window/mode/
 * sel inputs so the pick stays in the current view ("what you see is what you
 * filter", DEC-042 #330). Picking "All crew" (empty value) DROPS the `crew` param
 * rather than carrying `crew=`. No-JS tradeoff: without JS the crew filter can't
 * apply (the preset chips stay plain links) — acceptable on this desktop-first,
 * JS-assumed admin surface.
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
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      name="crew"
      defaultValue={crew ?? ""}
      disabled={pending}
      aria-busy={pending}
      className={className}
      onChange={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        const params = new URLSearchParams();
        for (const [key, value] of new FormData(form).entries()) {
          // Skip empties so "All crew" clears the filter instead of `crew=`.
          if (typeof value === "string" && value !== "") params.set(key, value);
        }
        const base = form.getAttribute("action") || pathname;
        const qs = params.toString();
        startTransition(() => router.push(qs ? `${base}?${qs}` : base));
      }}
    >
      <option value="">All crew</option>
      {crewList.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
