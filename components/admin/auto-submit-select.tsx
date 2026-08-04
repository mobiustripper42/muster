"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { confirmLeaveIfDirty } from "./dirty-state";

/**
 * Navigate-on-change for filter controls — the mechanism `CrewSelect` introduced for
 * the all-shifts filter (#330), extracted so a second surface doesn't grow a
 * near-identical twin (the drift shape behind #599's four SMS openers and #600's three
 * fill doors).
 *
 * A `<select onChange>` / date-input `onChange` needs client JS; this is the earned,
 * contained island (DEC-147) for a desktop-first, JS-assumed admin surface. **No-JS
 * tradeoff:** without JS the control doesn't apply on its own, so a surface that must
 * work without it has to keep a submit button too.
 *
 * Empty values are dropped from the query string, so an "All …" option clears its param
 * instead of carrying `param=`.
 */
function useFormNavigate(): {
  pending: boolean;
  /** Navigates, or returns false when an unsaved edit made the operator say no. */
  navigate: (el: HTMLSelectElement | HTMLInputElement) => boolean;
} {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  return {
    pending,
    navigate: (el) => {
      const form = el.form;
      if (!form) return false;
      // These navigate by router.push, which fires neither `beforeunload` nor a click
      // a capture-phase anchor guard could see — so the unsaved-edit check has to
      // happen here, or switching crew member mid-edit discards it in silence.
      if (!confirmLeaveIfDirty()) return false;
      const params = new URLSearchParams();
      for (const [key, v] of new FormData(form).entries()) {
        if (typeof v === "string" && v !== "") params.set(key, v);
      }
      const base = form.getAttribute("action") || pathname;
      const qs = params.toString();
      startTransition(() => router.push(qs ? `${base}?${qs}` : base));
      return true;
    },
  };
}

export function AutoSubmitSelect({
  name,
  value,
  options,
  includeEmpty,
  className,
  ariaLabel,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  /** Renders a leading empty option with this label (e.g. "All crew"). */
  includeEmpty?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const { pending, navigate } = useFormNavigate();
  return (
    <select
      name={name}
      // `key` forces a remount when the server sends a different value — an
      // uncontrolled control only reads `defaultValue` on mount, so after a
      // client-side nav (a tab, a ‹/› step) it would otherwise keep showing the value
      // it was born with while the page around it moved on.
      key={value}
      defaultValue={value}
      disabled={pending}
      aria-busy={pending}
      aria-label={ariaLabel}
      className={className}
      onChange={(e) => {
        // Declined: put the control back to what the page is actually showing, so it
        // doesn't sit displaying a crew member you aren't looking at.
        if (!navigate(e.currentTarget)) e.currentTarget.value = value;
      }}
    >
      {includeEmpty !== undefined && <option value="">{includeEmpty}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The same navigate-on-change, for a date input. Exists because the time clock's day
 * view dropped its "View day" button and the bare `<input type="date">` left behind did
 * nothing at all when you picked a date — a control that silently ignores you.
 */
export function AutoSubmitDate({
  name,
  value,
  id,
  className,
  ariaLabel,
}: {
  name: string;
  value: string;
  id?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const { pending, navigate } = useFormNavigate();
  return (
    <input
      type="date"
      id={id}
      name={name}
      key={value}
      defaultValue={value}
      disabled={pending}
      aria-busy={pending}
      aria-label={ariaLabel}
      className={className}
      onChange={(e) => {
        // Ignore the half-typed intermediate states a date input emits while the user
        // is still keyboarding ("2026-08-" etc.) — navigate only on a complete date.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.currentTarget.value)) return;
        if (!navigate(e.currentTarget)) e.currentTarget.value = value;
      }}
    />
  );
}
