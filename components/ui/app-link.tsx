import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { NavSpinner, NavLinkLabel } from "./nav-spinner";

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
 * - `spinner="inline"` (default) — the label swaps to a spinner IN PLACE while
 *   navigating (no layout shift; the link doesn't grow, siblings don't move). For
 *   nav items, chips, back-links, text links.
 * - `spinner="overlay"` — a scrim + big centered spinner over the nearest
 *   positioned ancestor (a card/row). The link must sit inside a `relative` box.
 * - `spinner="none"` — opt out (rarely needed; external hrefs opt out on their own).
 *
 * **`scroll={false}` is worth reaching for.** `next/link` defaults to scrolling to the top on
 * every navigation, and since every internal link here is a server round-trip, that default
 * fires constantly. For a link that REFINES the page you're already on — picking a date or a
 * departure on `/book`, paging a month — it throws the reader back to the hero and they have to
 * scroll down again to see what they just chose. Pass it through (it reaches `<Link>` via
 * `...props`). Keep the default for links that change what the page IS; landing mid-page there
 * is its own kind of wrong.
 */
export function AppLink({
  children,
  spinner = "inline",
  ...props
}: ComponentProps<typeof Link> & {
  children?: ReactNode;
  spinner?: "inline" | "overlay" | "none";
}) {
  const href = typeof props.href === "string" ? props.href : "";
  const external =
    /^(https?:|tel:|mailto:|#)/.test(href) || props.target === "_blank";
  const mode = external ? "none" : spinner;

  if (mode === "overlay") {
    return (
      <Link {...props}>
        {children}
        <NavSpinner overlay />
      </Link>
    );
  }
  if (mode === "inline") {
    return (
      <Link {...props}>
        <NavLinkLabel>{children}</NavLinkLabel>
      </Link>
    );
  }
  return <Link {...props}>{children}</Link>;
}
