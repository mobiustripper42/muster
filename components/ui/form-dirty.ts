/**
 * Is this form holding anything the operator hasn't saved? (#781)
 *
 * **Dirty is a comparison, not a flag.** The form's current values against the values it was
 * born with. `components/admin/dirty-submit.tsx` originally set a boolean on the first `input`
 * event, which is cheaper and answers a subtly different question — *has anything happened* —
 * and so stays stuck ON after the operator types a character and deletes it. Issue #781 named
 * settling this as the real work, because an over-eager guard gets muted by the person it is
 * protecting.
 *
 * Reducing a form to `[name, value]` pairs is the same move `app/lib/form-draft.ts:82` makes on
 * the submission it stashes, and it covers every control type through one code path: text,
 * textarea, number, select, radio, and the checkbox case a per-field diff misses (an unticked
 * box posts nothing, so ticking one ADDS an entry rather than changing one).
 */

/**
 * A canonical string for a set of submitted values. Two forms holding the same state produce
 * the same string; any difference in names, values, or how many times a name repeats produces
 * a different one.
 *
 * **Sorted, so a multi-value group is order-insensitive** — ticking vessel A then B is the same
 * state as B then A, and a guard that disagreed would warn about a form nobody changed.
 *
 * **`JSON.stringify` of the tuples rather than a delimiter join**, which is the trap in every
 * hand-rolled version of this: `"ab" + "c"` and `"a" + "bc"` collide the moment the parts are
 * concatenated, and two different forms sharing a state string is a guard that stays silent on
 * a real edit.
 */
export function canonicalFormState(pairs: Iterable<[string, string]>): string {
  const sorted = [...pairs].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  return JSON.stringify(sorted);
}

/**
 * The same thing for a live form.
 *
 * `File` entries are skipped for the reason `form-draft.ts` skips them — this project's forms
 * have none, and a file input's value is the browser's, not ours. If one ever lands here it
 * reads as unchanged rather than as permanently dirty.
 *
 * Covered by `e2e/unsaved-guard.spec.ts` rather than by the unit test beside this file: Vitest
 * runs `environment: "node"` (`vitest.config.ts`) with no jsdom, so there is no `FormData` here
 * to hand it. The sortable half above is where the logic that can be wrong lives.
 */
export function formState(form: HTMLFormElement): string {
  const pairs: [string, string][] = [];
  for (const [name, value] of new FormData(form).entries()) {
    if (typeof value === "string") pairs.push([name, value]);
  }
  return canonicalFormState(pairs);
}

/**
 * The state the form was BORN with — its server-rendered defaults, not whatever is in it now.
 *
 * **Read from a detached clone, and that is the whole point.** `cloneNode(true)` copies
 * *attributes*, and a control's attribute is its default: `value` for text, `checked` for a
 * checkbox, `selected` for an option. Whatever the operator has since typed lives in the DOM
 * *property*, which the clone does not carry. So this returns the baseline no matter when it is
 * called, and every control type comes through the one `FormData` path rather than a per-type
 * branch that silently misses the seventh.
 *
 * **It exists because snapshotting the live form at mount is a race.** The guard's effect runs
 * at hydration; on a compile-on-demand dev route that can be seconds after the form is on screen
 * and typeable. Anything entered in that window became part of the baseline, so the form read
 * clean and the guard stayed silent on real work — which is exactly the class of bug this
 * feature exists to prevent. Caught by `e2e/unsaved-guard.spec.ts`'s crew case, where the fill
 * beat hydration every run.
 *
 * On a form restored after a refusal the defaults ARE the operator's own values, because
 * `app/lib/form-draft.ts` hands them back as the defaults — so the restored form is born holding
 * them and starts clean, which is the behaviour issue #781 asks for.
 */
export function bornFormState(form: HTMLFormElement): string {
  return formState(form.cloneNode(true) as HTMLFormElement);
}
