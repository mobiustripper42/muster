"use client";

import type { ReactNode } from "react";
import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHeld } from "./use-held";

/**
 * Submit button for a **native GET filter form** (#250) — the third click-feedback
 * case, alongside `<SubmitButton>` (server-action submits) and `<AppLink>` (link
 * navigation). A `<form method="get">` does a full-page navigation with no React
 * pending state, so neither wrapper covers it. This intercepts the submit, does a
 * soft `router.push` with the form's fields as query params (keeps the bookmarkable
 * URL — and it's faster than the full reload it replaces), and shows the same in-
 * flight spinner (swapped in place, no layout shift), held for a visible beat.
 *
 * Must be a `type="submit"` inside the GET form.
 */
export function GetFormSubmit({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const showing = useHeld(pending);
  const router = useRouter();
  const pathname = usePathname();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={showing}
      className={showing ? `relative ${className ?? ""}` : className}
      onClick={(e) => {
        const form = e.currentTarget.form;
        // Invalid input → let the browser block + show validation as usual.
        if (!form || !form.reportValidity()) return;
        e.preventDefault();
        const params = new URLSearchParams();
        for (const [key, value] of new FormData(form).entries()) {
          if (typeof value === "string") params.set(key, value);
        }
        // A GET form with no `action` posts to the current path; one with an
        // `action` posts there. Mirror that, then apply the fields as the query.
        const base = form.getAttribute("action") || pathname;
        const qs = params.toString();
        startTransition(() => router.push(qs ? `${base}?${qs}` : base));
      }}
    >
      {showing ? (
        <>
          <span className="opacity-0">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <span
              aria-hidden="true"
              className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-[3px] border-current border-r-transparent"
            />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
