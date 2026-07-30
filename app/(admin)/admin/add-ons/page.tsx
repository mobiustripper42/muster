import type { AddOn, Offering } from "@core/domain/entities.js";
import { Notice } from "../../../../components/ui/notice";
import { Shell } from "../../../../components/ui/shell";
import { AppLink } from "../../../../components/ui/app-link";
import { AdminSignedOut } from "../../../../components/admin/admin-signed-out";
import { SubmitButton } from "../../../../components/ui/submit-button";
import { VersionTag } from "../../../../components/ui/version-tag";
import { Field, settingsInputClass } from "../../../../components/admin/settings-field";
import { readSubject } from "../../../lib/auth";
import { getRepo } from "../../../lib/repo";
import { saveAddOn } from "./actions";

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

const ERR_COPY: Record<string, string> = {
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
  const selected = creating ? null : addOns.find((a) => a.id === sp.sel) ?? addOns[0] ?? null;
  const errCopy = sp.err ? ERR_COPY[sp.err] ?? ERR_COPY.error : null;
  const title = creating ? "New add-on" : selected?.label ?? "Add-ons";

  return (
    <Shell width="6xl">
      <form
        key={creating ? "new" : selected?.id ?? "none"}
        action={saveAddOn}
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

        {errCopy && <Notice tone="bad">{errCopy}</Notice>}

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
      </form>

      <VersionTag />
    </Shell>
  );
}

/** The "Add-on" facts card. The Save button lives in the page header (shared form). */
function AddOnCard({ addOn, creating }: { addOn: AddOn | null; creating: boolean }) {
  const isNew = creating || !addOn;
  return (
    <section className="rounded-card border border-line bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Add-on</h2>
      </div>

      <div className="px-4 py-1">
        <Field label="Label" sub="what the customer sees">
          <input
            name="label"
            required
            defaultValue={addOn?.label ?? ""}
            className={`${settingsInputClass} w-full max-w-[420px]`}
          />
        </Field>

        <Field label="Amount" sub="a flat charge, revenue">
          <span className="flex items-center gap-2">
            <span className="text-xs text-faint">$</span>
            <input
              name="amount"
              required
              inputMode="decimal"
              defaultValue={addOn ? (addOn.amountCents / 100).toFixed(2) : ""}
              className={`${settingsInputClass} max-w-[130px] font-mono`}
            />
          </span>
        </Field>

        <Field label="Required" sub="the customer must buy it">
          <label className="flex items-center gap-2 pt-1 text-sm text-ink">
            <input type="checkbox" name="required" defaultChecked={addOn?.required ?? false} />
            Required at checkout
          </label>
        </Field>

        <Field label="Active" sub="uncheck to retire">
          <label className="flex items-center gap-2 pt-1 text-sm text-ink">
            {/* Default checked on a new add-on; retired add-ons drop from the offering picker
                + browse but keep their references (DEC-123 soft-delete). */}
            <input type="checkbox" name="active" defaultChecked={isNew ? true : addOn.active} />
            Available to attach to offerings
          </label>
        </Field>
      </div>
    </section>
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
