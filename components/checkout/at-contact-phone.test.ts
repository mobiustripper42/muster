import { describe, expect, it } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { atContactPhone, callUsToBook } from "@core/reservations/contact-phone.js";
import { AtContactPhone, CallUsToBook } from "./at-contact-phone";

/**
 * The string and component pairs are two homes on purpose: a string cannot carry a link, and the
 * form's error renders a string (issue #1159). These hold each component's text to its string
 * function, spaces included, because a lost space here reads "call at(216) 555-0100" on a screen
 * that Vitest cannot otherwise see. Each number case also pins the words themselves, so two empty
 * halves cannot agree.
 */
const PHONE = "+12165550100";
const LINK = /<a [^>]*href="tel:\+12165550100"[^>]*>\(216\) 555-0100<\/a>/;

type Phone = typeof PHONE | null;

function render(component: ComponentType<{ phone: Phone }>, phone: Phone): string {
  return renderToStaticMarkup(createElement(component, { phone }));
}

/** The markup with its tags out: split on `<` and `>`, the even pieces are the text between tags. */
const text = (html: string): string =>
  html
    .split(/[<>]/)
    .filter((_, i) => i % 2 === 0)
    .join("");

describe("AtContactPhone", () => {
  it("AC8: reads the same as atContactPhone, and only the number is the link", () => {
    const html = render(AtContactPhone, PHONE);
    expect(text(html)).toBe(" at (216) 555-0100");
    expect(text(html)).toBe(atContactPhone(PHONE));
    expect(html).toMatch(LINK);
  });

  it("AC9: with no number it renders nothing, as atContactPhone says", () => {
    const html = render(AtContactPhone, null);
    expect(html).toBe("");
    expect(text(html)).toBe(atContactPhone(null));
  });
});

describe("CallUsToBook", () => {
  it("AC5: reads the same as callUsToBook, and only the number is the link", () => {
    const html = render(CallUsToBook, PHONE);
    expect(text(html)).toBe("Call us at (216) 555-0100 and we’ll book it for you");
    expect(text(html)).toBe(callUsToBook(PHONE));
    expect(html).toMatch(LINK);
  });

  it("AC9: with no number it reads as callUsToBook does, with no link", () => {
    const html = render(CallUsToBook, null);
    expect(text(html)).toBe("Call us and we’ll book it for you");
    expect(text(html)).toBe(callUsToBook(null));
    expect(html).not.toContain("<a");
  });
});
