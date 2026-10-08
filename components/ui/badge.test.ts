import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge, Tag, type Tone } from "./badge";

/**
 * The two read-only pills (issue #484): a `<Badge>` says what state a thing is in, a `<Tag>`
 * carries data — a name, a count, an amount. Lint holds that no page writes a pill by hand; this
 * holds that the components draw what their names promise.
 */
const html = (c: typeof Badge, props: Omit<Parameters<typeof Badge>[0], "children">, text = "Live") =>
  renderToStaticMarkup(createElement(c, { ...props, children: text }));

const classes = (markup: string) => markup.match(/class="([^"]*)"/)![1]!.split(" ");

const TONES: [Tone, string][] = [
  ["neutral", "text-muted"],
  ["accent", "text-accent"],
  ["ok", "text-ok"],
  ["warn", "text-warn"],
  ["bad", "text-bad"],
];

describe.each([
  ["Badge", Badge],
  ["Tag", Tag],
] as const)("%s", (_, Pill) => {
  it.each(TONES)("tone %s writes its text in %s", (tone, text) => {
    expect(classes(html(Pill, { tone }))).toContain(text);
  });

  it("is neutral when no tone is given", () => {
    expect(classes(html(Pill, {}))).toContain("text-muted");
  });

  it("passes a test id through and appends layout classes", () => {
    const props = { tone: "ok", "data-testid": "state", className: "shrink-0" } as const;
    const markup = html(Pill, props);
    expect(markup).toContain('data-testid="state"');
    expect(classes(markup)).toContain("shrink-0");
  });

  // `rounded-full` rounds to half the box's height, so a label that wraps to two lines turns
  // the pill into an oval. A fixed corner keeps one line a pill and two lines a rounded box.
  it("has a fixed corner, so a wrapped label is not an oval", () => {
    expect(classes(html(Pill, {}))).not.toContain("rounded-full");
  });
});

describe("Badge and Tag differ in what they hold", () => {
  it("a Badge is a state word, set in capitals", () => {
    expect(classes(html(Badge, {}))).toContain("uppercase");
  });

  it("a Tag is data, shown as written", () => {
    expect(classes(html(Tag, {}, "Hops Tour"))).not.toContain("uppercase");
  });
});
