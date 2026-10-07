import type { ElementType } from "react";
import type { Box } from "./card";
import { join } from "./join";

/**
 * The one message box (issue #484, part 4): a tinted `ok`/`bad`/`warn` box, or a neutral one on
 * white with no tone. `no-restricted-syntax` fails the build on the tinted look written by hand.
 * Unlike a `<Card>` it has no shadow — it says something, it does not hold things.
 *
 * `as` and the element's own props pass through (`role="alert"`, a `<details>` that opens);
 * `className` is for layout. Text is 14px in the tone's colour; a child that needs to be louder
 * (a one-line celebration) sets its own size.
 */
type NoticeTone = "ok" | "bad" | "warn";

const NOTICE_TONE: Record<NoticeTone | "none", string> = {
  ok: "border-ok-line bg-ok-bg text-ok",
  bad: "border-bad-line bg-bad-bg text-bad",
  warn: "border-warn-line bg-warn-bg text-warn",
  none: "border-line bg-card text-muted",
};

export function Notice<T extends ElementType = "div">({
  as,
  tone,
  className,
  ...props
}: Box<T> & { tone?: NoticeTone }) {
  const Tag: ElementType = as ?? "div";
  return (
    <Tag {...props} className={join("rounded-card border px-4 py-3 text-sm", NOTICE_TONE[tone ?? "none"], className)} />
  );
}
