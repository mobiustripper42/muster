import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Field } from "./field";

/**
 * A `<Field>` label is tied to what it labels (issue #484, part 6): one control through
 * `htmlFor`, several through `group`. Lint holds that every Field says which; this holds that
 * saying it produces the markup a browser and a screen reader act on.
 */
function render(props: Parameters<typeof Field>[0]): string {
  return renderToStaticMarkup(createElement(Field, props));
}

const control = createElement("input", { id: "n", name: "n" });

describe.each(["stacked", "row"] as const)("Field, %s layout", (layout) => {
  it("with htmlFor, renders a real <label> pointed at the control", () => {
    const html = render({ label: "Name", htmlFor: "n", layout, children: control });
    expect(html).toContain('<label for="n"');
    expect(html).not.toContain('role="group"');
  });

  it("with group, names the wrapper by its label", () => {
    const html = render({ label: "Days", group: true, layout, children: control });
    const group = html.match(/role="group" aria-labelledby="([^"]+)"/);
    expect(group).not.toBeNull();
    expect(html).toContain(`<span id="${group![1]}"`);
    expect(html).not.toContain("<label");
  });
});
