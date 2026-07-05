import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { NavSpinner } from "./nav-spinner";

/**
 * The standard internal-navigation link (#250) — a `next/link` with the loading
 * spinner built in. Every internal navigation in this app is a `force-dynamic`
 * server round-trip (there are no "fast" internal links), so every one deserves
 * feedback; `AppLink` gives it for free. **Use this instead of `next/link` for any
 * in-app href.** For a `tel:` / `mailto:` / external / `#` target — which don't
 * load a page — use a plain `<a>` (AppLink also auto-suppresses the spinner for
 * those, as a safety net).
 *
 * The `<Link>` stays server-rendered; only the tiny `<NavSpinner>` is a client
 * island (it reads `useLinkStatus`, which must be a descendant of the Link).
 *
 * - `spinner="inline"` (default) — a small spinner after the label (nav items,
 *   chips, back-links, text links). The link should be `inline-flex`/`flex` with
 *   `items-center` so it aligns; most already are.
 * - `spinner="overlay"` — a scrim + big centered spinner over the nearest
 *   positioned ancestor (a card/row). The link must sit inside a `relative` box.
 * - `spinner="none"` — opt out (rarely needed; external hrefs opt out on their own).
 */
export function AppLink({
  children,
  spinner = "inline",
  spinnerClassName,
  ...props
}: ComponentProps<typeof Link> & {
  children?: ReactNode;
  spinner?: "inline" | "overlay" | "none";
  spinnerClassName?: string;
}) {
  const href = typeof props.href === "string" ? props.href : "";
  const external =
    /^(https?:|tel:|mailto:|#)/.test(href) || props.target === "_blank";
  const mode = external ? "none" : spinner;

  return (
    <Link {...props}>
      {children}
      {mode === "inline" && (
        <NavSpinner
          size="h-4 w-4"
          className={spinnerClassName ?? "ml-1.5 text-accent"}
        />
      )}
      {mode === "overlay" && <NavSpinner overlay />}
    </Link>
  );
}
