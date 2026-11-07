/**
 * The operator's contact phone (issue #1159). A hand-written `app_settings` row, so the read has
 * three outcomes: blank is "no number yet" and silent, a real number is canonical in any spelling,
 * and anything else is `null` with a log line. `readContactPhone` is what the pages call, and it
 * sits on `/b/find`'s confirmation, which must not fail, so it never throws.
 *
 * What each adapter does with the row is `repository-contract.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTACT_PHONE_KEY,
  atContactPhone,
  callUsToBook,
  cutoffRefusalMessage,
  parseContactPhone,
  readContactPhone,
} from "./contact-phone.js";

const PHONE = "+12165550100";

describe("parseContactPhone", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([[null], [undefined], [""], ["   "]])("AC1: %j is no number, and nothing is logged", (raw) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseContactPhone(raw)).toBeNull();
    expect(err).not.toHaveBeenCalled();
  });

  it.each(["(216) 555-0100", "216-555-0100", "+12165550100"])("AC2: %j reads as +12165550100", (raw) => {
    expect(parseContactPhone(raw)).toBe(PHONE);
  });

  it.each(["call Drew", "555-0100"])("AC3: %j reads as null, with one log line", (raw) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseContactPhone(raw)).toBeNull();
    expect(err).toHaveBeenCalledOnce();
  });
});

describe("CONTACT_PHONE_KEY", () => {
  it("AC2: is the key the operator's SQL writes", () => {
    expect(CONTACT_PHONE_KEY).toBe("booking.contact_phone");
  });
});

describe("readContactPhone", () => {
  afterEach(() => vi.restoreAllMocks());

  it("AC1: no number reads as null, and nothing is logged", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readContactPhone({ getContactPhone: async () => null })).toBeNull();
    expect(err).not.toHaveBeenCalled();
  });

  it("AC2: hands back the number the repository read", async () => {
    expect(await readContactPhone({ getContactPhone: async () => PHONE })).toBe(PHONE);
  });

  it("AC4: a read that throws synchronously returns null and logs", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = {
      getContactPhone: () => {
        throw new Error("the pool is gone");
      },
    };
    expect(await readContactPhone(repo)).toBeNull();
    expect(err).toHaveBeenCalled();
  });

  it("AC4: a read that rejects returns null and logs", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = { getContactPhone: () => Promise.reject(new Error("the pool is gone")) };
    expect(await readContactPhone(repo)).toBeNull();
    expect(err).toHaveBeenCalled();
  });
});

describe("the sentences", () => {
  it("AC5: callUsToBook carries the number in its clause", () => {
    expect(callUsToBook(PHONE)).toBe("Call us at (216) 555-0100 and we’ll book it for you");
  });

  it("AC9: callUsToBook with no number keeps today's clause", () => {
    expect(callUsToBook(null)).toBe("Call us and we’ll book it for you");
  });

  it("AC8: atContactPhone is the words that go after 'give us a call'", () => {
    expect(atContactPhone(PHONE)).toBe(" at (216) 555-0100");
  });

  it("AC9: atContactPhone with no number is nothing at all", () => {
    expect(atContactPhone(null)).toBe("");
  });

  it("AC7: cutoffRefusalMessage gives the number", () => {
    expect(cutoffRefusalMessage(PHONE)).toBe(
      "That departure is now too close to book online. Call us at (216) 555-0100 and we’ll book it for you — you have not been charged.",
    );
  });

  it("AC7: cutoffRefusalMessage with no number is today's sentence", () => {
    expect(cutoffRefusalMessage(null)).toBe(
      "That departure is now too close to book online. Call us and we’ll book it for you — you have not been charged.",
    );
  });
});
