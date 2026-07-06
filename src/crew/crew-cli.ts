/**
 * Crew contact management — the break-glass lever for fixing a crew member's
 * phone/email on a live DB (Phase 10.5). A wrong phone means no SMS; a wrong
 * email means the login code never matches — the two most likely pilot fires,
 * and until this existed the only fix was raw SQL.
 *
 * Scope is deliberately `list` + `set` (contact fields only). Crew are created
 * elsewhere (seed / import); this doesn't `add` or delete — it just corrects the
 * fields an operator needs to fix in a pinch. Setting a real crew email here is
 * also the prerequisite for `db:admin add --email=…` (DEC-092), which resolves
 * an admin against the crew roster.
 *
 * Framework-free (Repository port), so it's unit-testable on the in-memory
 * double and runs on Postgres unchanged — same shape as `admin-cli.ts`.
 */
import { asId } from "../domain/ids.js";
import { normalizeEmail } from "../auth/login-code.js";
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
const KNOWN_SET_FLAGS = ["email", "phone", "name"] as const;

const USAGE =
  "Usage:\n" +
  "  db:crew list\n" +
  '  db:crew set <crewId> [--email=<addr>] [--phone=<+E164>] [--name="<name>"]\n' +
  "  (empty --email= clears the email; phone and name cannot be blanked)";

/** Execute one crew command. Returns the human-readable result line(s);
 *  throws {@link CrewCliError} on bad input or a missing target. */
export async function runCrewCommand(repo: Repository, args: string[]): Promise<string> {
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
            `${c.status === "active" ? "●" : "○"} ${c.id.padEnd(20)} ${c.name.padEnd(22)} ` +
            `${c.phone.padEnd(15)} ${c.email ?? "(no email)"}`,
        )
        .join("\n");
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

    default:
      throw new CrewCliError(`Unknown command "${cmd ?? ""}".\n${USAGE}`);
  }
}
