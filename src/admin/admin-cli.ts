/**
 * Admin management — the launch interface for the `admins` table (DEC-092). At ~3
 * admins there is no management UI (deferred); this is `add`/`revoke`/`reactivate`/
 * `list`, run via `db:admin` against a live DB. Framework-free (Repository port), so
 * it's unit-testable on the in-memory double and runs on Postgres unchanged.
 *
 * `add` resolves the admin's id — which IS a crew id (DEC-092) — either from an
 * `--email` (a scan of the crew roster, DEC-081-style; NB crew ≠ Xola customers, so
 * the email must already be on the crew record) or an explicit `--crew=<id>`.
 */
import type { Admin } from "../domain/entities.js";
import { asId } from "../domain/ids.js";
import { normalizeEmail } from "../auth/login-code.js";
import type { Repository } from "../ports/repository.js";

/** A user-facing CLI error (bad args / not found) — the entrypoint prints its
 *  message and exits non-zero, no stack trace. */
export class AdminCliError extends Error {}

const flag = (args: string[], name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const USAGE =
  "Usage:\n" +
  "  db:admin list\n" +
  '  db:admin add --email=<addr>|--crew=<crewId> --handle=<handle> [--name="<name>"]\n' +
  "  db:admin revoke <handle>\n" +
  "  db:admin reactivate <handle>";

/** Execute one admin command. Returns the human-readable result line(s);
 *  throws {@link AdminCliError} on bad input or a missing target. */
export async function runAdminCommand(
  repo: Repository,
  args: string[],
  now: Date,
): Promise<string> {
  const cmd = args[0];

  switch (cmd) {
    case "list": {
      const admins = (await repo.listAdmins()).sort((a, b) =>
        a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0,
      );
      if (admins.length === 0) return "No admins.";
      return admins
        .map(
          (a) =>
            `${a.active ? "●" : "○"} ${a.handle.padEnd(12)} ${a.id.padEnd(26)} ${a.name}` +
            (a.active ? "" : `  (revoked ${a.deactivatedAt})`),
        )
        .join("\n");
    }

    case "add": {
      const handle = flag(args, "handle");
      if (!handle) throw new AdminCliError(`add: --handle=<handle> is required.\n${USAGE}`);
      const email = flag(args, "email");
      const crew = flag(args, "crew");
      if ((email && crew) || (!email && !crew))
        throw new AdminCliError("add: pass exactly one of --email=<addr> or --crew=<crewId>.");
      if (await repo.getAdminByHandle(handle))
        throw new AdminCliError(`add: handle "${handle}" is already an admin.`);

      let id: string;
      let name = flag(args, "name");
      if (email) {
        const norm = normalizeEmail(email);
        const match = (await repo.listCrewMembers())
          .filter((c) => c.email && normalizeEmail(c.email) === norm)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
        if (!match)
          throw new AdminCliError(
            `add: no crew member has email "${email}". Crew are not Xola customers — set the ` +
              `email on their crew record first, or use --crew=<id>.`,
          );
        id = match.id;
        name ??= match.name;
      } else {
        id = crew!;
        name ??= (await repo.getCrewMember(asId<"CrewMemberId">(id)))?.name;
      }
      if (!name)
        throw new AdminCliError(
          `add: no crew member found for ${id} to take a name from — pass --name="<name>".`,
        );

      const clash = await repo.getAdmin(id);
      if (clash)
        throw new AdminCliError(`add: ${id} is already admin "${clash.handle}".`);

      const admin: Admin = {
        id,
        handle,
        name,
        active: true,
        createdAt: now.toISOString(),
        deactivatedAt: null,
      };
      await repo.saveAdmin(admin);
      return `Added admin: ${handle} → ${id} (${name}).`;
    }

    case "revoke": {
      const handle = args[1];
      if (!handle) throw new AdminCliError(`revoke: usage: db:admin revoke <handle>.`);
      const a = await repo.getAdminByHandle(handle);
      if (!a) throw new AdminCliError(`revoke: no admin with handle "${handle}".`);
      if (!a.active) return `Admin "${handle}" is already revoked.`;
      await repo.saveAdmin({ ...a, active: false, deactivatedAt: now.toISOString() });
      return `Revoked admin: ${handle} (${a.id}). Their session dies on the next request.`;
    }

    case "reactivate": {
      const handle = args[1];
      if (!handle) throw new AdminCliError(`reactivate: usage: db:admin reactivate <handle>.`);
      const a = await repo.getAdminByHandle(handle);
      if (!a) throw new AdminCliError(`reactivate: no admin with handle "${handle}".`);
      if (a.active) return `Admin "${handle}" is already active.`;
      await repo.saveAdmin({ ...a, active: true, deactivatedAt: null });
      return `Reactivated admin: ${handle} (${a.id}).`;
    }

    default:
      throw new AdminCliError(`Unknown command "${cmd ?? ""}".\n${USAGE}`);
  }
}
