import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input, Select, Textarea, type FieldDensity } from "./input";

/**
 * The field box on desktop (issue #1200): from `sm:` up every box has the same space between its
 * letters and its border on all four sides, and a select draws its own arrow, inset like its text.
 * Below `sm:` the box is what it was — the operator ruled the phone fine as it is.
 *
 * Markup only: this holds that each control carries the desktop box and keeps the phone one. That
 * the gaps actually measure even is a render, checked against the real pages.
 */
function classes(el: ReturnType<typeof createElement>): string[] {
  const html = renderToStaticMarkup(el);
  const cls = html.match(/class="([^"]*)"/)?.[1];
  if (cls === undefined) throw new Error(`no class attribute in ${html}`);
  return cls.split(/\s+/);
}

const DENSITIES: FieldDensity[] = ["touch", "dense"];

const PHONE = {
  line: { touch: ["min-h-[44px]", "px-3", "text-base"], dense: ["min-h-9", "px-2", "text-sm"] },
  textarea: { touch: ["px-3", "py-2", "text-base"], dense: ["px-2", "py-1.5", "text-sm"] },
};

describe.each(DENSITIES)("%s density", (density) => {
  const input = classes(createElement(Input, { density }));
  const select = classes(createElement(Select, { density }));
  const textarea = classes(createElement(Textarea, { density }));

  it("keeps the phone box below sm:", () => {
    expect(input).toEqual(expect.arrayContaining(PHONE.line[density]));
    expect(select).toEqual(expect.arrayContaining(PHONE.line[density]));
    expect(textarea).toEqual(expect.arrayContaining(PHONE.textarea[density]));
  });

  it("gives Input and Select a fixed desktop height in place of the touch floor", () => {
    for (const box of [input, select]) {
      expect(box).toContain("sm:min-h-0");
      expect(box.some((c) => c.startsWith("sm:h-"))).toBe(true);
    }
  });

  it("insets the letters the same on every control on desktop", () => {
    for (const box of [input, select, textarea]) expect(box).toContain("sm:px-2");
    expect(textarea.some((c) => c.startsWith("sm:py-"))).toBe(true);
  });

  it("draws the select arrow on desktop, and only on a select", () => {
    expect(select).toContain("sm:select-arrow");
    expect(input).not.toContain("sm:select-arrow");
    expect(textarea).not.toContain("sm:select-arrow");
  });
});
