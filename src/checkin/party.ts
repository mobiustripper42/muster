/**
 * The booker's party page (Phase 18.6, issue #1120) — every signed name on one booking and the count,
 * for `/b/<code>/party`. Spec: `docs/design/check-in-surfaces.md` §B.
 *
 * **Every name, never "… 10 more"**: the booker is looking for who is missing, and a folded name is
 * one she cannot see. An obvious duplicate shows once, "×2", and counts once (`duplicates.ts`). The
 * count is the success screen's (`groupCoverage`), so the two pages never disagree, and no number
 * passes the party size or the boat's limit (spec §4a) — the names are all listed regardless.
 */
import type { Guest } from "./entities.js";
import { groupSignings, peopleSigned } from "./duplicates.js";
import { ageOn, groupCoverage } from "./signing.js";

export interface PartyName {
  name: string;
  /** A minor's age today; absent on an adult, and once retention has cleared the date of birth. */
  age?: number;
  /** How many times this person signed — 2 or more shows "×2". */
  times: number;
}

export interface PartyView {
  names: PartyName[];
  coverage: { covered: number; of: number; remaining: number };
}

export function buildPartyView(
  /** The signings on this booking. */
  guests: readonly Guest[],
  partySize: number,
  coiMaxPax: number,
  /** Boat-local `YYYY-MM-DD` — a minor's age is measured on it. */
  today: string,
): PartyView {
  // A person is shown by their earliest signing — the name as they first typed it.
  const names = groupSignings(guests)
    .map((group) => ({ first: group[0]!, times: group.length }))
    .sort(
      (a, b) =>
        a.first.name.localeCompare(b.first.name, "en", { sensitivity: "base" }) ||
        String(a.first.id).localeCompare(String(b.first.id)),
    )
    .map(({ first, times }): PartyName => ({
      name: first.name,
      ...(first.isMinor && first.dob ? { age: ageOn(first.dob, today) } : {}),
      times,
    }));
  return { names, coverage: groupCoverage(partySize, peopleSigned(guests), coiMaxPax) };
}
