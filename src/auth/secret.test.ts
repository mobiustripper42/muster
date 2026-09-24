import { describe, expect, it } from "vitest";
import { hashSecret, randomSecret } from "./secret.js";

describe("randomSecret", () => {
  it("produces distinct, URL-safe secrets", () => {
    const a = randomSecret();
    const b = randomSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashSecret", () => {
  it("is a stable sha256 hex that never equals the secret it hides", () => {
    expect(hashSecret("s3cret")).toBe(hashSecret("s3cret"));
    expect(hashSecret("s3cret")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret("s3cret")).not.toBe(hashSecret("s3cret2"));
  });
});
