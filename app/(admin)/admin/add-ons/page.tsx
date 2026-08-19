import type { AddOn, Offering } from "@core/domain/entities.js";
import { ActionForm } from "../../../../components/ui/action-form";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { saveAddOn, type AddOnErr } from "./actions";
import { AddOnCard } from "./add-on-card";

/**
 * /admin/add-ons (#491, DEC-123) — the Add-on settings twin, matching the Vessel/Location
 * screens: a full-width header (breadcrumb + name + Save), an add-on list on the left, the
 * add-on's facts on the right (label, amount, Required, Active), plus a read-only Offerings
 * reverse lookup. Master–detail via `?sel=<id|new>`, native forms, no JS (DEC-026). The whole
 * surface is one `<form>` so Save can sit in the header while the fields sit in the card.
 *
 * `required` is a GLOBAL property of the add-on (offerings just attach ids). `active` is the
 * DEC-123 soft-retire: unchecking it drops the add-on from the offering picker + browse without
 * a hard delete — there is deliberately no remove path.
 */

export const dynamic = "force-dynamic";

type Search = { sel?: string; saved?: string; err?: string };

const ERR_COPY: Record<AddOnErr, string> = {
  name_required: "Give the add-on a label.",
  bad_amount: "The amount must be a dollar figure (like 0, 29, or 150.00), not negative.",
  error: "Couldn’t save that just now — try again in a moment.",
};

export default async function AdminAddOns({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const subject = await readSubject();
  if (!subject || subject.kind !== "admin") return <AdminSignedOut subject={subject} />;

  let addOns: AddOn[];
  let offerings: Offering[];
  try {
    const repo = getRepo();
    [addOns, offerings] = await Promise.all([repo.listAddOns(), repo.listOfferings()]);
  } catch {
    return (
      <Shell width="6xl">
        <Notice>Couldn’t reach the add-ons right now. Try again in a moment.</Notice>
      </Shell>
    );
  }
  addOns.sort((a, b) => a.label.localeCompare(b.label));

  // Empty list ⇒ open straight into the create form (with its Create button) rather than a
  // blank form with no way to save.
  const creating = sp.sel === "new" || addOns.length === 0;
  // No first-record substitution — see the note in admin/offerings (#699).
  const selected = creating
    ? null
    : sp.sel
      ? addOns.find((a) => a.id === sp.sel) ?? null
      : addOns[0] ?? null;
  const title = creating ? "New add-on" : selected?.label ?? "Add-ons";

  return (
    <Shell width="6xl">
      {/* #699: the `key` still resets the card when you switch records, but a returned refusal
          no longer flips it — so a validation error keeps what you typed. */}
      <ActionForm
        key={creating ? "new" : selected?.id ?? "none"}
        action={saveAddOn}
        errCopy={ERR_COPY}
        fallback="error"
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="id" value={creating || !selected ? "" : selected.id} />

        <header className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-faint">
              Setup / Add-ons{selected || creating ? ` / ${title}` : ""}
            </p>
            <h1 className="truncate text-[22px] font-semibold leading-tight text-ink">{title}</h1>
          </div>
          {(selected || creating) && (
            <SubmitButton className="ml-auto min-h-[40px] shrink-0 rounded-card bg-accent px-4 text-sm font-semibold text-white">
              {creating || !selected ? "Create" : "Save"}
            </SubmitButton>
          )}
        </header>

        {/* No `?err=` read here any more (#699): `saveAddOn` returns its refusal to the
            ActionForm above, which renders it. */}

        <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-[230px_1fr]">
          <nav className="flex flex-col gap-0.5 self-start rounded-card border border-line bg-card p-1.5">
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
              Add-ons
            </p>
            {addOns.map((a) => (
              <AppLink
                key={a.id}
                href={`/admin/add-ons?sel=${a.id}`}
                aria-current={selected?.id === a.id ? "page" : undefined}
                className={`block rounded-[9px] px-2.5 py-2 text-sm ${
                  selected?.id === a.id ? "bg-bg font-medium text-ink" : "text-muted"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                  {!a.active && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
                      Retired
                    </span>
                  )}
                </span>
              </AppLink>
            ))}
            <AppLink
              href="/admin/add-ons?sel=new"
              className={`mx-0.5 mt-1.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-sm text-accent ${
                creating ? "font-medium" : ""
              }`}
            >
              + New add-on
            </AppLink>
          </nav>

          <div className="flex flex-col gap-4">
            <AddOnCard addOn={selected} creating={creating} />
            {selected && <OfferingsSection addOn={selected} offerings={offerings} />}
          </div>
        </div>
      </ActionForm>

      <VersionTag />
    </Shell>
  );
}

/** Read-only reverse lookup — the offerings that attach this add-on. The Offering owns the link. */
function OfferingsSection({ addOn, offerings }: { addOn: AddOn; offerings: Offering[] }) {
  const used = offerings.filter((o) => o.addOnIds?.includes(addOn.id));
  return (
    <section className="rounded-card border border-line bg-card shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Offerings</h2>
      </div>
      <div className="px-4 py-3">
        {used.length === 0 ? (
          <p className="text-sm text-muted">Not attached to any offerings yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {used.map((o) => (
              <span key={o.id} className="rounded-full border border-line px-3 py-1 text-xs text-muted">
                {o.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
