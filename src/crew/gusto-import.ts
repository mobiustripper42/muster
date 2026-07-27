/**
 * Bulk-match crew to Gusto identities lifted from `xola-tip-extractor`'s `guide-gusto-map.json`
 * (DEC-124, 12.3b). The extractor OWNS that map until Xola sunsets; this is a one-way BOOTSTRAP
 * copy into Muster crew rows (re-runnable to re-sync), NOT Muster forking the map.
 *
 * Pure + fs-free so it unit-tests without disk — the caller (`db:crew import-gusto`) reads the
 * file. The join is by NAME (the map key is the Xola guide name; the extractor already carries
 * overrides where that differs from "First Last"). A crew member with no map match stays
 * unmapped (safe — their tips warn at CSV time; never a wrong employeeId). Ambiguous matches
 * (a name that hits >1 entry, or >1 crew normalizing alike) are surfaced, never applied.
 */
import type { GustoIdentity } from "../domain/entities.js";

/** One entry from the extractor map, already field-renamed to Muster's shape by the loader. */
export interface GustoMapEntry {
  /** The map KEY — the Xola guide name. The join key against `CrewMember.name`. */
  name: string;
  firstName: string;
  lastName: string;
  title: string;
  employeeId: string;
}

export interface GustoImportMatch {
  crewId: string;
  crewName: string;
  gusto: GustoIdentity;
}

export interface GustoImportPlan {
  /** Crew that matched exactly one entry → safe to apply. */
  matched: GustoImportMatch[];
  /** Crew names with no map entry (stay unmapped — tips warn at CSV time). */
  crewWithoutEntry: string[];
  /** Map entries that matched no crew (roster drift — surfaced, not applied). */
  entriesWithoutCrew: string[];
  /** Names that matched ambiguously (>1 crew or >1 entry) — surfaced, never applied. */
  ambiguous: string[];
}

/** Loose join key: trimmed, lowercased, internal whitespace collapsed. */
const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

export function planGustoImport(
  crew: readonly { id: string; name: string }[],
  entries: readonly GustoMapEntry[],
): GustoImportPlan {
  // Index both sides by normalized name, tracking collisions on each side.
  const crewByKey = new Map<string, { id: string; name: string }[]>();
  for (const c of crew) {
    const k = norm(c.name);
    (crewByKey.get(k) ?? crewByKey.set(k, []).get(k)!).push({ id: c.id, name: c.name });
  }
  const entryByKey = new Map<string, GustoMapEntry[]>();
  for (const e of entries) {
    const k = norm(e.name);
    (entryByKey.get(k) ?? entryByKey.set(k, []).get(k)!).push(e);
  }

  const matched: GustoImportMatch[] = [];
  const crewWithoutEntry: string[] = [];
  const ambiguous: string[] = [];

  for (const [k, cs] of crewByKey) {
    const es = entryByKey.get(k);
    if (!es) {
      crewWithoutEntry.push(...cs.map((c) => c.name));
      continue;
    }
    if (cs.length > 1 || es.length > 1) {
      // A collision on either side: applying could seed the wrong employeeId. Refuse it.
      ambiguous.push(cs.map((c) => c.name).join(" / "));
      continue;
    }
    const c = cs[0]!;
    const e = es[0]!;
    matched.push({
      crewId: c.id,
      crewName: c.name,
      gusto: { firstName: e.firstName, lastName: e.lastName, title: e.title, employeeId: e.employeeId },
    });
  }

  const matchedKeys = new Set(matched.map((m) => norm(m.crewName)));
  const ambiguousKeys = new Set(
    [...crewByKey.keys()].filter((k) => {
      const cs = crewByKey.get(k)!;
      const es = entryByKey.get(k);
      return es && (cs.length > 1 || es.length > 1);
    }),
  );
  const entriesWithoutCrew: string[] = [];
  for (const [k, es] of entryByKey) {
    if (!matchedKeys.has(k) && !ambiguousKeys.has(k)) entriesWithoutCrew.push(...es.map((e) => e.name));
  }

  return {
    matched: matched.sort((a, b) => a.crewName.localeCompare(b.crewName)),
    crewWithoutEntry: crewWithoutEntry.sort(),
    entriesWithoutCrew: entriesWithoutCrew.sort(),
    ambiguous: ambiguous.sort(),
  };
}
