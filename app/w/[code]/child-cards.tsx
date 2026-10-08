"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useFormStatus } from "react-dom";
import { ADD_CHILD, REMOVE_CHILD } from "./child-intent";
import { DateOfBirth, type DobParts } from "./date-of-birth";
import { Card } from "../../../components/ui/card";
import { Field } from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";

/**
 * The minor cards on the waiver form, and "+ Add a minor" under them (Phase 18.4; operator,
 * 2026-10-01). The guest reads "minor", never "child": a parent of a sixteen-year-old does not think
 * "child", and "under the age of majority" is the rule (operator, 2026-10-02). The code keeps
 * `child`, which no guest sees.
 *
 * **Why this is an island (DEC-147 rule 2).** A parent adds a minor, types, adds the next, types —
 * on a phone, at the dock. As server round trips that is a page reload between every one, on dock
 * Wi-Fi. Here a card appears at once and its name field takes the focus.
 *
 * **Without JS it still works.** Both buttons are real submit buttons carrying an `intent`: the
 * sign action adds or removes the card and brings the whole form back through the form-draft, the
 * way the vessels page adds crew rows (#861). With JS the click is handled here and nothing is sent.
 *
 * Every card posts the same four names (`childName`, `childMonth`, `childDay`, `childYear`), read
 * in order with `getAll`, so removing a card renumbers only the headings. The fields are
 * uncontrolled: each card's key keeps what was typed in it when a card above it goes.
 *
 * The two buttons are raw `<button type="submit">`, not `SubmitButton` (DEC-090): with JS they
 * never submit, so there is no round trip to show a spinner for, and without JS no spinner runs.
 * They are disabled while Sign is in flight, which is the part of `SubmitButton` that applies.
 */

const CHILD_FIELDS: DobParts = { month: "childMonth", day: "childDay", year: "childYear" };

type ChildCard = { key: number; name: string; added: boolean } & DobParts;

export function ChildCards({
  initial,
  max,
  years,
  ageOfMajority,
}: {
  /** The cards to open with — a refused or restored form's children, else none. */
  initial: ({ name: string } & DobParts)[];
  max: number;
  /** The child birth-year list (`birthYearOptions("child", …)`). */
  years: number[];
  ageOfMajority: number;
}) {
  const [cards, setCards] = useState<ChildCard[]>(() => initial.map((c, i) => ({ ...c, key: i, added: false })));
  const nextKey = useRef(initial.length);
  const { pending } = useFormStatus();
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAddAfterRemove = useRef(false);

  // The Remove button goes with its card, which would drop the focus to the page — a keyboard or
  // screen-reader user starts again from the top. It lands on "+ Add a minor" instead, after the
  // render: at ten cards that button was not on the page when Remove was tapped.
  useEffect(() => {
    if (!focusAddAfterRemove.current) return;
    focusAddAfterRemove.current = false;
    addButton.current?.focus();
  }, [cards]);

  const add = (e: MouseEvent) => {
    e.preventDefault();
    const key = nextKey.current++;
    setCards((cs) =>
      cs.length >= max ? cs : [...cs, { key, name: "", month: "", day: "", year: "", added: true }],
    );
  };
  const remove = (key: number) => (e: MouseEvent) => {
    e.preventDefault();
    focusAddAfterRemove.current = true;
    setCards((cs) => cs.filter((c) => c.key !== key));
  };

  return (
    <>
      {cards.map((c, i) => (
        <Card key={c.key} as="section" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Minor {i + 1}</h2>
            {/* `formNoValidate`: removing a card must not be blocked by a blank field in it. */}
            {/* eslint-disable-next-line muster/raw-submit -- handled in the browser, no round trip to spin for (header) */}
            <button type="submit"
              name="intent"
              value={`${REMOVE_CHILD}${i}`}
              formNoValidate
              disabled={pending}
              onClick={remove(c.key)}
              className="-my-2 -mr-2 inline-flex min-h-[44px] items-center gap-1 px-2 text-sm text-muted"
            >
              <span aria-hidden="true">✕</span> Remove<span className="sr-only"> minor {i + 1}</span>
            </button>
          </div>
          <Field label="Minor’s full name" htmlFor={`child-name-${i}`}>
            {/* Only a card just added takes the focus — add, type, add, type. */}
            <Input id={`child-name-${i}`} name="childName" required maxLength={100} defaultValue={c.name} autoFocus={c.added} className="w-full" />
          </Field>
          <DateOfBirth names={CHILD_FIELDS} years={years} defaults={c} label={`Minor ${i + 1}’s date of birth`} />
        </Card>
      ))}
      <div className="flex flex-col gap-2">
        {cards.length < max ? (
          // `formNoValidate`: adding a card must not be blocked by the blank one above it.
          // eslint-disable-next-line muster/raw-submit -- handled in the browser, no round trip to spin for (header)
          <button type="submit"
            ref={addButton}
            name="intent"
            value={ADD_CHILD}
            formNoValidate
            disabled={pending}
            onClick={add}
            className="btn-secondary min-h-[48px] w-full"
          >
            + Add a minor
          </button>
        ) : (
          <p className="text-center text-sm text-muted">{max} minors is the most on one signature.</p>
        )}
        <p className="text-center text-xs text-muted">For anyone under {ageOfMajority} coming with you.</p>
      </div>
    </>
  );
}
