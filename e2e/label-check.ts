/**
 * `expectLabelsResolve(page)` — every `<label for>` on the page names a field (issue #1194).
 *
 * A `for` naming an id that is absent, or that sits on something that cannot be labelled, renders
 * fine and does nothing: the click focuses nothing and a screen reader announces the field
 * unnamed. Nothing in the build sees it, so this is the check.
 *
 * Labelable is the HTML standard's list: `input` other than `type=hidden`, `select`, `textarea`,
 * `button`, `meter`, `output`, `progress`. A hidden input is not one.
 *
 * It rejects (a hard failure, not a soft `expect`) with a message naming each dangling `for`.
 */
import type { Page } from "@playwright/test";

export async function expectLabelsResolve(page: Page): Promise<void> {
  const dangling = await page.evaluate(() => {
    const labelable = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "input") return (el as HTMLInputElement).type !== "hidden";
      return ["select", "textarea", "button", "meter", "output", "progress"].includes(tag);
    };
    const bad: string[] = [];
    for (const label of Array.from(document.querySelectorAll("label[for]"))) {
      const id = label.getAttribute("for") ?? "";
      const target = document.getElementById(id);
      if (labelable(target)) continue;
      const why = target ? `<${target.tagName.toLowerCase()}> is not labelable` : "no element has that id";
      bad.push(`for="${id}" (label "${(label.textContent ?? "").trim().slice(0, 40)}"): ${why}`);
    }
    return bad;
  });
  if (dangling.length > 0) {
    throw new Error(
      `${dangling.length} label(s) on ${page.url()} name no field:\n  ${dangling.join("\n  ")}`,
    );
  }
}
