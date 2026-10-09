import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Chip, chipLook, tileLook } from "./choice";

/**
 * One chip look (issue #484). A `<Chip>` is a toggle input under a pill face; a filter link
 * cannot be one, so it wears the same face through `chipLook`. These hold that the two read
 * the same, on and off, and that neither face turns into an oval when its label wraps.
 */
const chip = renderToStaticMarkup(
  createElement(Chip, { type: "checkbox", name: "d", value: "1", children: "Mon" }),
);
const face = chip.match(/<span class="([^"]*)"/)![1]!.split(" ");

describe("Chip", () => {
  it("is a real checkbox under its face", () => {
    expect(chip).toMatch(/<input[^>]*type="checkbox"[^>]*name="d"/);
  });

  // `rounded-full` rounds to half the box's height; a two-line add-on chip at 375px was an oval.
  it("has a fixed corner, so a wrapped label is not an oval", () => {
    expect(face).not.toContain("rounded-full");
  });
});

describe("chipLook, the chip face for a link", () => {
  const checked = face.filter((c) => c.startsWith("peer-checked:")).map((c) => c.slice(13));

  it("on, is exactly what a checked Chip shows", () => {
    expect(checked.length).toBeGreaterThan(0);
    for (const c of checked) expect(chipLook(true, "dense").split(" ")).toContain(c);
  });

  it("off, is the unchecked Chip's edge and fill", () => {
    const off = chipLook(false, "dense").split(" ");
    for (const c of ["border-line-strong", "bg-card", "text-muted"]) expect(off).toContain(c);
    expect(off).not.toContain("bg-ink");
  });

  it("dense is the Chip's own size and corner", () => {
    const dense = chipLook(false, "dense").split(" ");
    for (const c of face.filter((c) => /^(rounded|px|py|text-sm)/.test(c))) expect(dense).toContain(c);
  });

  it("touch keeps the 44px tap floor, with no corner that would oval it", () => {
    const touch = chipLook(false, "touch").split(" ");
    expect(touch).toContain("min-h-[44px]");
    expect(touch).not.toContain("rounded-full");
  });
});

/**
 * The tile face (issue #484, part C). `muster/control-edge` cannot read a class built by a function,
 * so these hold the one thing it would have: an unpicked tile wears the control edge, never the
 * card's hairline.
 */
describe("tileLook, the choice tile face", () => {
  it("unpicked, wears the control edge and a card fill — not the card's hairline", () => {
    const off = tileLook(false).split(" ");
    for (const c of ["rounded-box", "border", "border-line-strong", "bg-card"]) expect(off).toContain(c);
    expect(off).not.toContain("border-line");
  });

  it("picked, is the accent ring", () => {
    const on = tileLook(true).split(" ");
    for (const c of ["rounded-box", "border", "border-accent", "ring-1", "ring-accent"]) expect(on).toContain(c);
    expect(on).not.toContain("border-line-strong");
  });
});
