/**
 * Crew roster CLI — the operator's lever for the crew roster on a live DB, no
 * admin UI (mirrors `db:admin`; DEC-094):
 *   list           — the roster (active ● / inactive ○)
 *   add            — a new hire (DEC-044 note below)
 *   set            — fix contact fields (phone/email/name) in a pinch
 *   enable/disable — flip active↔inactive (inactive = never asked)
 *
 * `add` must produce an **askable** crew member. MMC is the universal hard gate
 * (`eligibility.ts` HARD_CREDENTIAL_TYPES), so a new hire with no MMC credential
 * is eligible for nothing and silently never gets asked. BrewBoat keeps no real
 * MMC dates yet (DEC-044), so `add` seeds the same far-future placeholder the
 * roster seed does — replace with a real `--mmc` date once collected. A wrong
 * phone means no SMS; a wrong email means the login code never matches — `set`
 * fixes those (and a real crew email is the prerequisite for `db:admin add
 * --email=…`, DEC-092).
 *
 * Framework-free (Repository port), so it's unit-testable on the in-memory
 * double and runs on Postgres unchanged — same shape as `admin-cli.ts`.
 */
import type { CrewMember, RoleType } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { normalizeEmail } from "../auth/login-code.js";
import { scoreCrewMember, effectiveRankScore } from "../oracle/reliability-score.js";
import type { Repository } from "../ports/repository.js";

/** A user-facing CLI error (bad args / not found) — the entrypoint prints its
 *  message and exits non-zero, no stack trace. */
export class CrewCliError extends Error {}

/** Returns the flag's value, `""` if passed empty (`--email=`), or `undefined`
 *  if the flag is absent — so callers can tell "clear it" from "leave it". */
const flag = (args: string[], name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// SMS needs a real E.164 number; a bad one silently breaks the exact thing this
// lever exists to fix, so reject it loudly rather than persist junk.
const E164 = /^\+[1-9]\d{6,14}$/;
const looksLikeEmail = (s: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_SET_FLAGS = ["email", "phone", "name"] as const;
const KNOWN_ADD_FLAGS = ["name", "phone", "ratings", "email", "id", "mmc"] as const;

/** Weekday tokens, index = the Mon=0…Sun=6 value stored in `weekdaysOff` (DEC-119). */
const WEEKDAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Parse a `--days=sun,sat` token to a sorted, de-duped Mon=0…Sun=6 set. Throws on
 *  an empty list or an unknown token (a silent drop would be a false "done"). */
const parseDays = (raw: string): number[] => {
  const toks = raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (toks.length === 0)
    throw new CrewCliError("days-off: --days= is empty. Pass e.g. --days=sun,sat, or --clear.");
  const set = new Set<number>();
  for (const t of toks) {
    const i = (WEEKDAY_NAMES as readonly string[]).indexOf(t);
    if (i === -1)
      throw new CrewCliError(`days-off: "${t}" isn't a weekday. Use: ${WEEKDAY_NAMES.join(", ")}.`);
    set.add(i);
  }
  return [...set].sort((a, b) => a - b);
};

/** "sun, sat" from `[5,6]` — sorted, for display. */
const formatDays = (days: number[]): string =>
  [...days].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d] ?? String(d)).join(", ");

/** DEC-044 far-future sentinel MMC — keeps the universal MMC gate open until real
 *  credential tracking lands. Sole owner of the sentinel since DEC-134 retired
 *  `db/seed-pilot-crew.ts`; `db:crew add` is now the only roster-bootstrap path. */
const PLACEHOLDER_MMC_EXPIRY = "2099-12-31";

/** `crew-<slug>` id from a name: "Jane Roe" → "crew-jane-roe". */
const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Resolve a `--ratings` token to a real RoleTypeId, by name ("captain"), id
 *  ("role-captain"), or bare suffix. Throws with the valid set on no match. */
const resolveRating = (roleTypes: RoleType[], token: string) => {
  const t = token.toLowerCase();
  const rt = roleTypes.find(
    (r) => r.name.toLowerCase() === t || r.id.toLowerCase() === t || r.id.toLowerCase() === `role-${t}`,
  );
  if (!rt) {
    const valid = roleTypes.map((r) => r.name).join(", ") || "(none — run db:seed:fleet first)";
    throw new CrewCliError(`add: "${token}" isn't a known role. Valid: ${valid}.`);
  }
  return rt.id;
};

const USAGE =
  "Usage:\n" +
  "  db:crew list\n" +
  "  db:crew rank                — crew by reliability score, best first (#404)\n" +
  '  db:crew add --name="<name>" --phone=<+E164> --ratings=<r1,r2> [--email=<addr>] [--id=<crewId>] [--mmc=<YYYY-MM-DD>]\n' +
  '  db:crew set <crewId> [--email=<addr>] [--phone=<+E164>] [--name="<name>"]\n' +
  "  db:crew days-off                              — roster of everyone with recurring days off (#411)\n" +
  "  db:crew days-off <crewId> [--days=sun,mon,… (COMMA-separated) | --clear]   — show/set/clear one crew member\n" +
  "  db:crew disable <crewId>   |   db:crew enable <crewId>\n" +
  "  db:crew archive <crewId>   |   db:crew unarchive <crewId>\n" +
  "  (disable = benched but still manually placeable; archive = off every list)\n" +
  "  (set: empty --email= clears the email; phone/name can't be blanked)";

/** Execute one crew command. Returns the human-readable result line(s);
 *  throws {@link CrewCliError} on bad input or a missing target. */
export async function runCrewCommand(
  repo: Repository,
  args: string[],
  now: Date = new Date(),
): Promise<string> {
  const cmd = args[0];

  switch (cmd) {
    case "list": {
      const crew = (await repo.listCrewMembers()).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      if (crew.length === 0) return "No crew members.";
      return crew
        .map(
          (c) =>
            // ● active · ○ inactive (benched) · ✗ archived (off every list, #323)
            `${c.status === "active" ? "●" : c.status === "archived" ? "✗" : "○"} ${c.id.padEnd(20)} ${c.name.padEnd(22)} ` +
            `${c.phone.padEnd(15)} ${c.email ?? "(no email)"}`,
        )
        .join("\n");
    }

    // Crew ranked by reliability, best first (#404). Uses the SAME score + manual
    // thumb the ask loop ranks on (`scoreCrewMember` + `effectiveRankScore`), so
    // this is the true ask order — not a parallel metric. Empty log ⇒ neutral 0
    // (`events` shows why a name sits at 0); a `*` marks a manual floor/boost.
    case "rank": {
      const crew = await repo.listCrewMembers();
      if (crew.length === 0) return "No crew members.";
      const keyed = await Promise.all(
        crew.map(async (c) => {
          const s = await scoreCrewMember(repo, c.id, now);
          return { c, key: effectiveRankScore(s.score, c), events: s.eventCount };
        }),
      );
      keyed.sort((a, b) =>
        a.key !== b.key ? b.key - a.key : a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0,
      );
      const header = " #   score  events  crew";
      const rows = keyed.map(({ c, key, events }, i) => {
        const thumb = c.manualFloor !== undefined || c.manualBoost !== undefined ? "*" : " ";
        const mark = c.status === "active" ? "●" : c.status === "archived" ? "✗" : "○";
        return (
          `${String(i + 1).padStart(2)}  ${key.toFixed(1).padStart(6)}${thumb} ` +
          `${String(events).padStart(5)}   ${mark} ${c.name} (${c.id})`
        );
      });
      return [header, ...rows, "", "* = manual floor/boost applied · ● active ○ benched ✗ archived"].join("\n");
    }

    case "add": {
      const stray = args.slice(1).find((a) => !a.startsWith("--"));
      if (stray)
        throw new CrewCliError(`add: unexpected argument "${stray}" — add takes only --flags.\n${USAGE}`);
      const bad = args
        .slice(1)
        .find((a) => !KNOWN_ADD_FLAGS.some((k) => a.startsWith(`--${k}=`)));
      if (bad) throw new CrewCliError(`add: unrecognized flag "${bad}".\n${USAGE}`);

      const name = (flag(args, "name") ?? "").trim();
      if (!name) throw new CrewCliError(`add: --name="<full name>" is required.\n${USAGE}`);

      const phone = (flag(args, "phone") ?? "").trim();
      if (!E164.test(phone))
        throw new CrewCliError(
          `add: --phone must be E.164 (e.g. +15035550123) — got "${flag(args, "phone") ?? ""}".`,
        );

      const ratingsArg = flag(args, "ratings");
      if (!ratingsArg)
        throw new CrewCliError("add: --ratings=<role,role> is required (e.g. --ratings=captain,mate).");
      const roleTypes = await repo.listAllRoleTypes();
      const ratings = [
        ...new Set(
          ratingsArg
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((tok) => resolveRating(roleTypes, tok)),
        ),
      ];
      if (ratings.length === 0)
        throw new CrewCliError("add: --ratings needs at least one role (e.g. --ratings=mate).");

      let normEmail: string | undefined;
      const email = flag(args, "email");
      if (email !== undefined && email !== "") {
        const norm = normalizeEmail(email);
        if (!looksLikeEmail(norm))
          throw new CrewCliError(`add: "${email}" doesn't look like an email address.`);
        const clash = (await repo.listCrewMembers()).find(
          (o) => o.email && normalizeEmail(o.email) === norm,
        );
        if (clash)
          throw new CrewCliError(
            `add: email "${norm}" is already on ${clash.id} (${clash.name}). One email can't serve two crew.`,
          );
        normEmail = norm;
      }

      const idArg = flag(args, "id")?.trim();
      const id = idArg && idArg.length > 0 ? idArg : `crew-${slugify(name)}`;
      if (id === "crew-")
        throw new CrewCliError(`add: couldn't derive an id from "${name}" — pass --id=<crewId>.`);
      if (await repo.getCrewMember(asId<"CrewMemberId">(id)))
        throw new CrewCliError(
          `add: id "${id}" already exists. Pass a different --id, or use \`db:crew set\` to edit them.`,
        );

      const mmcArg = flag(args, "mmc")?.trim();
      let mmcExpiry = PLACEHOLDER_MMC_EXPIRY;
      if (mmcArg) {
        // Strict: shape AND a real calendar date — 2027-04-31 must NOT roll to
        // May 1 and get stored as the operator's typo'd string.
        const d = new Date(`${mmcArg}T00:00:00Z`);
        if (!ISO_DATE.test(mmcArg) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== mmcArg)
          throw new CrewCliError(`add: --mmc must be a real date YYYY-MM-DD (got "${mmcArg}").`);
        mmcExpiry = mmcArg;
      }

      const crewId = asId<"CrewMemberId">(id);
      const member: CrewMember = {
        id: crewId,
        name,
        phone,
        ...(normEmail ? { email: normEmail } : {}),
        ratings,
        status: "active",
        reliabilityScore: null,
      };
      // Atomic: the crew record AND its MMC gate land together, or neither. MMC
      // is the universal hard gate (DEC-044) — a member without it is eligible
      // for nothing, and a half-write would strand an un-re-addable ghost.
      await repo.addCrewMemberWithCredential(member, {
        id: asId<"CredentialId">(`cred-${id}-mmc`),
        crewMemberId: crewId,
        type: "MMC",
        expiry: mmcExpiry,
      });

      const roleNames = ratings
        .map((rid) => roleTypes.find((r) => r.id === rid)?.name ?? rid)
        .join(", ");
      const mmcNote = mmcArg
        ? `MMC valid to ${mmcExpiry}`
        : `MMC = placeholder (${PLACEHOLDER_MMC_EXPIRY}, DEC-044) — set a real --mmc date when you collect it`;
      return (
        `Added ${name} (${id}):\n` +
        `  phone   ${phone}\n` +
        `  email   ${normEmail ?? "(none)"}\n` +
        `  ratings ${roleNames}\n` +
        `  ${mmcNote}`
      );
    }

    case "enable":
    case "disable": {
      const id = args[1];
      if (!id || id.startsWith("--"))
        throw new CrewCliError(`${cmd}: a crew id is required. Usage: db:crew ${cmd} <crewId>.`);
      // Reject a stray/mistyped trailing arg rather than silently ignore it
      // (same principle as add/set — a typo mustn't read as success).
      if (args.length > 2)
        throw new CrewCliError(
          `${cmd}: unexpected argument "${args[2]}". Usage: db:crew ${cmd} <crewId>.`,
        );
      const status = cmd === "enable" ? "active" : "inactive";
      const updated = await repo.setCrewStatus(asId<"CrewMemberId">(id), status);
      if (!updated)
        throw new CrewCliError(`${cmd}: no crew member with id "${id}". Run \`db:crew list\`.`);
      return cmd === "enable"
        ? `Enabled ${updated.name} (${updated.id}) — back in the ask pool.`
        : `Disabled ${updated.name} (${updated.id}) — they won't be asked for shifts until you enable them again.`;
    }

    case "archive":
    case "unarchive": {
      const id = args[1];
      if (!id || id.startsWith("--"))
        throw new CrewCliError(`${cmd}: a crew id is required. Usage: db:crew ${cmd} <crewId>.`);
      if (args.length > 2)
        throw new CrewCliError(
          `${cmd}: unexpected argument "${args[2]}". Usage: db:crew ${cmd} <crewId>.`,
        );
      // archive → off every list (asks + the manual override picker/guard, #323).
      // unarchive → back to `active` (they're with the operation again); disable
      // after if you want them benched. History is untouched either way.
      const status = cmd === "archive" ? "archived" : "active";
      const updated = await repo.setCrewStatus(asId<"CrewMemberId">(id), status);
      if (!updated)
        throw new CrewCliError(`${cmd}: no crew member with id "${id}". Run \`db:crew list\`.`);
      return cmd === "archive"
        ? `Archived ${updated.name} (${updated.id}) — off every list, including the manual override picker. History kept; \`db:crew unarchive ${updated.id}\` to restore.`
        : `Unarchived ${updated.name} (${updated.id}) — back in the ask pool and placeable again.`;
    }

    case "set": {
      const id = args[1];
      if (!id || id.startsWith("--"))
        throw new CrewCliError(`set: a crew id is required.\n${USAGE}`);

      // Reject a mistyped flag rather than silently no-op it — under a break-glass
      // fix, `--pone=…` succeeding with phone unchanged is a false "done".
      const bad = args
        .slice(2)
        .find((a) => a.startsWith("--") && !KNOWN_SET_FLAGS.some((k) => a.startsWith(`--${k}=`)));
      if (bad)
        throw new CrewCliError(
          `set: unrecognized flag "${bad}". Known: --email, --phone, --name.\n${USAGE}`,
        );

      const email = flag(args, "email");
      const phone = flag(args, "phone");
      const name = flag(args, "name");
      if (email === undefined && phone === undefined && name === undefined)
        throw new CrewCliError(
          `set: pass at least one of --email, --phone, or --name.\n${USAGE}`,
        );

      const fields: { name?: string; phone?: string; email?: string | null } = {};
      const changes: string[] = [];

      if (email !== undefined) {
        if (email === "") {
          fields.email = null;
          changes.push("email → (cleared)");
        } else {
          const norm = normalizeEmail(email);
          if (!looksLikeEmail(norm))
            throw new CrewCliError(`set: "${email}" doesn't look like an email address.`);
          // Two crew sharing an email breaks login: matchCrewByEmail resolves it to
          // one of them (lowest id), so the other silently can't get in — the exact
          // failure this tool exists to fix. Refuse to create the collision.
          const clash = (await repo.listCrewMembers()).find(
            (o) => o.id !== id && o.email && normalizeEmail(o.email) === norm,
          );
          if (clash)
            throw new CrewCliError(
              `set: email "${norm}" is already on ${clash.id} (${clash.name}). One email can't ` +
                `serve two crew — login would resolve to just one of them.`,
            );
          fields.email = norm;
          changes.push(`email → ${norm}`);
        }
      }

      if (phone !== undefined) {
        const p = phone.trim();
        if (!E164.test(p))
          throw new CrewCliError(
            `set: phone "${phone}" is not E.164 (e.g. +15035550123) — SMS needs this exact shape.`,
          );
        fields.phone = p;
        changes.push(`phone → ${p}`);
      }

      if (name !== undefined) {
        const n = name.trim();
        if (n === "") throw new CrewCliError("set: --name cannot be blank.");
        fields.name = n;
        changes.push(`name → ${n}`);
      }

      // Targeted UPDATE (DEC-094) — touches only the contact columns, so a
      // concurrent engine write to reliability/status/ratings isn't clobbered.
      const updated = await repo.updateCrewContact(asId<"CrewMemberId">(id), fields);
      if (!updated)
        throw new CrewCliError(
          `set: no crew member with id "${id}". Run \`db:crew list\` to find the id.`,
        );
      return `Updated ${updated.name} (${updated.id}):\n  ${changes.join("\n  ")}`;
    }

    // Recurring weekday time-off (#411, DEC-119): read `weekdaysOff`, or set/clear
    // it via a targeted UPDATE (DEC-094-safe). Mon=0…Sun=6; subtractive, whole-day,
    // vessel-local — the eligibility gate's `not_recurring_off` rule reads it.
    case "days-off": {
      const id = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      const clear = args.includes("--clear");
      const daysFlag = flag(args, "days");

      // No id + no set/clear ⇒ roster of everyone WITH recurring days off.
      if (!id && !clear && daysFlag === undefined) {
        const off = (await repo.listCrewMembers())
          .filter((c) => (c.weekdaysOff ?? []).length > 0)
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        if (off.length === 0) return "No crew have recurring days off.";
        return off
          .map((c) => `${c.id.padEnd(20)} ${c.name.padEnd(22)} ${formatDays(c.weekdaysOff!)}`)
          .join("\n");
      }
      if (!id)
        throw new CrewCliError(`days-off: a crew id is required to set or clear.\n${USAGE}`);

      // A bare token after the id (e.g. `--days=sun mon` → "mon") is almost always a
      // space where a comma belongs — reject it loudly rather than silently drop it.
      const stray = args.slice(2).find((a) => !a.startsWith("--"));
      if (stray)
        throw new CrewCliError(
          `days-off: unexpected argument "${stray}" — weekdays go in ONE comma-separated flag: --days=sun,mon.\n${USAGE}`,
        );
      const bad = args
        .slice(2)
        .find((a) => a.startsWith("--") && a !== "--clear" && !a.startsWith("--days="));
      if (bad)
        throw new CrewCliError(
          `days-off: unrecognized flag "${bad}". Known: --days=sun,mon,…, --clear.\n${USAGE}`,
        );

      // Id + no set/clear ⇒ show that one crew member's set (read-only).
      if (!clear && daysFlag === undefined) {
        const c = await repo.getCrewMember(asId<"CrewMemberId">(id));
        if (!c)
          throw new CrewCliError(`days-off: no crew member with id "${id}". Run \`db:crew list\`.`);
        const off = c.weekdaysOff ?? [];
        return off.length === 0
          ? `${c.name} (${c.id}) has no recurring days off.`
          : `${c.name} (${c.id}) is off: ${formatDays(off)}.`;
      }
      if (clear && daysFlag !== undefined)
        throw new CrewCliError("days-off: pass either --days=… or --clear, not both.");

      const weekdaysOff = clear ? [] : parseDays(daysFlag!);
      const updated = await repo.updateCrewWeekdaysOff(
        asId<"CrewMemberId">(id),
        weekdaysOff,
      );
      if (!updated)
        throw new CrewCliError(`days-off: no crew member with id "${id}". Run \`db:crew list\`.`);
      if (weekdaysOff.length === 0)
        return `Cleared recurring days off for ${updated.name} (${updated.id}).`;
      // Off all 7 is allowed (an emergent soft bench, DEC-119) but worth flagging —
      // it's not archived, just never eligible.
      const warn =
        weekdaysOff.length === 7
          ? "\n  ⚠ off every weekday — never asked or claimable (not archived; enable a day to undo)."
          : "";
      return `${updated.name} (${updated.id}) is now off: ${formatDays(weekdaysOff)}.${warn}`;
    }

    default:
      throw new CrewCliError(`Unknown command "${cmd ?? ""}".\n${USAGE}`);
  }
}
