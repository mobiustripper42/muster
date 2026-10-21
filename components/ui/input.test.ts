import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FIELD_HEIGHT, Input, Select, Textarea, type FieldDensity } from "./input";

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

/** 16px under the 15px root (`app/globals.css`), in rem so a raised browser font still scales it
 *  (issue #1194). `text-base` is 15px here, which is why iOS zoomed on focus. */
const SIXTEEN = "text-[calc(1rem+1px)]";

const PHONE = {
  line: { touch: ["min-h-[44px]", "px-3", SIXTEEN], dense: ["min-h-9", "px-2", SIXTEEN] },
  textarea: { touch: ["px-3", "py-2", SIXTEEN], dense: ["px-2", "py-1.5", SIXTEEN] },
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

/**
 * Issue #1194: 16px text below `sm:` so iOS Safari stops zooming on focus, and from `sm:` up the
 * size issue #1200's desktop boxes were measured on. The bare class is asserted ABSENT as well as
 * the literal present: with both on one element, which one wins is the stylesheet's order, not ours.
 */
function boxes(density: FieldDensity): string[][] {
  return [
    classes(createElement(Input, { density })),
    classes(createElement(Select, { density })),
    classes(createElement(Textarea, { density })),
  ];
}

describe("field text size (issue #1194)", () => {
  it("AC1: a touch Input, Select and Textarea set 16px text below sm:, not bare text-base", () => {
    for (const box of boxes("touch")) {
      expect(box).toContain(SIXTEEN);
      expect(box).not.toContain("text-base");
    }
  });

  it("AC2: a touch field keeps text-base from sm: up", () => {
    for (const box of boxes("touch")) expect(box).toContain("sm:text-base");
  });

  it("AC12: a dense Input, Select and Textarea set 16px text below sm:, not bare text-sm", () => {
    for (const box of boxes("dense")) {
      expect(box).toContain(SIXTEEN);
      expect(box).not.toContain("text-sm");
    }
  });

  it("AC12: a dense field keeps text-sm from sm: up", () => {
    for (const box of boxes("dense")) expect(box).toContain("sm:text-sm");
  });
});

describe("FIELD_HEIGHT (issue #1194)", () => {
  it("AC10: is the 44px phone floor and the 31px desktop height, and a touch Input and Select wear it", () => {
    expect(typeof FIELD_HEIGHT, "FIELD_HEIGHT is exported from ./input").toBe("string");
    const height = FIELD_HEIGHT.split(/\s+/);
    expect(height).toEqual(expect.arrayContaining(["min-h-[44px]", "sm:min-h-0", "sm:h-[calc(2rem+1px)]"]));
    for (const box of [classes(createElement(Input, {})), classes(createElement(Select, {}))]) {
      expect(box).toEqual(expect.arrayContaining(height));
    }
  });
});
