/**
 * saveLocationAdmin (task 12.9) — validation + upsert.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../adapters/in-memory-repository.js";
import { asId } from "../domain/ids.js";
import { saveLocationAdmin } from "./location-admin.js";

const base = {
  id: "loc-new",
  name: "East Bank",
  pickupDescription: "Dock 3, below the hotel",
  routeDescription: "Up the river and back",
};

describe("saveLocationAdmin — validation", () => {
  it("rejects blank name / pickup / route", async () => {
    const repo = new InMemoryRepository();
    expect(await saveLocationAdmin(repo, { ...base, name: " " })).toEqual({
      ok: false,
      code: "name_required",
    });
    expect(await saveLocationAdmin(repo, { ...base, pickupDescription: "" })).toEqual({
      ok: false,
      code: "pickup_required",
    });
    expect(await saveLocationAdmin(repo, { ...base, routeDescription: "" })).toEqual({
      ok: false,
      code: "route_required",
    });
  });

  it("rejects a pickup link that isn't an http(s) URL", async () => {
    const repo = new InMemoryRepository();
    expect(
      await saveLocationAdmin(repo, { ...base, pickupLink: "maps.google.com/foo" }),
    ).toEqual({ ok: false, code: "bad_link" });
  });

  it("accepts a valid location, trimming fields; link is optional", async () => {
    const repo = new InMemoryRepository();
    const r = await saveLocationAdmin(repo, {
      ...base,
      name: "  East Bank  ",
      pickupLink: "https://maps.google.com/?q=dock3",
    });
    expect(r).toEqual({ ok: true, id: "loc-new" });
    const saved = await repo.getLocation(asId<"LocationId">("loc-new"));
    expect(saved).toMatchObject({
      name: "East Bank",
      pickupDescription: "Dock 3, below the hotel",
      routeDescription: "Up the river and back",
      pickupLink: "https://maps.google.com/?q=dock3",
    });
  });

  it("omits pickupLink when blank", async () => {
    const repo = new InMemoryRepository();
    await saveLocationAdmin(repo, { ...base, pickupLink: "" });
    const saved = await repo.getLocation(asId<"LocationId">("loc-new"));
    expect(saved?.pickupLink).toBeUndefined();
  });
});
