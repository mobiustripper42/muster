"use client";

import { useRef, useState, type MouseEvent } from "react";
import { useFormStatus } from "react-dom";
import { ADD_CHILD, REMOVE_CHILD } from "./child-intent";
import { DateOfBirth, type DobParts } from "./date-of-birth";
import { card, input } from "./form-look";

/**
 * The child cards on the waiver form, and "+ Add a child" under them (Phase 18.4; operator,
 * 2026-10-01).
 *
 * **Why this is an island (DEC-147 rule 2).** A parent adds a child, types, adds the next, types —
 * on a phone, at the dock. As server round trips that is a page reload between every child, on dock
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

type Card = { key: number; name: string; added: boolean } & DobParts;

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
  const [cards, setCards] = useState<Card[]>(() => initial.map((c, i) => ({ ...c, key: i, added: false })));
  const nextKey = useRef(initial.length);
  const { pending } = useFormStatus();

  const add = (e: MouseEvent) => {
    e.preventDefault();
    const key = nextKey.current++;
    setCards((cs) =>
      cs.length >= max ? cs : [...cs, { key, name: "", month: "", day: "", year: "", added: true }],
    );
  };
  const remove = (key: number) => (e: MouseEvent) => {
    e.preventDefault();
    setCards((cs) => cs.filter((c) => c.key !== key));
  };

  return (
    <>
      {cards.map((c, i) => (
        <section key={c.key} className={card}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Child {i + 1}</h2>
            {/* `formNoValidate`: removing a card must not be blocked by a blank field in it. */}
            {/* eslint-disable-next-line no-restricted-syntax -- handled in the browser, no round trip to spin for (header) */}
            <button type="submit"
              name="intent"
              value={`${REMOVE_CHILD}${i}`}
              formNoValidate
              disabled={pending}
              onClick={remove(c.key)}
              className="-my-2 -mr-2 inline-flex min-h-[44px] items-center gap-1 px-2 text-sm text-muted"
            >
              <span aria-hidden="true">✕</span> Remove<span className="sr-only"> child {i + 1}</span>
            </button>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">Child’s full name</span>
            {/* Only a card just added takes the focus — add, type, add, type. */}
            <input name="childName" required maxLength={100} defaultValue={c.name} autoFocus={c.added} className={input} />
          </label>
          <DateOfBirth names={CHILD_FIELDS} years={years} defaults={c} label={`Child ${i + 1}’s date of birth`} />
        </section>
      ))}
      <div className="flex flex-col gap-2">
        {cards.length < max ? (
          // `formNoValidate`: adding a card must not be blocked by the blank one above it.
          // eslint-disable-next-line no-restricted-syntax -- handled in the browser, no round trip to spin for (header)
          <button type="submit"
            name="intent"
            value={ADD_CHILD}
            formNoValidate
            disabled={pending}
            onClick={add}
            className="btn-secondary min-h-[48px] w-full"
          >
            + Add a child
          </button>
        ) : (
          <p className="text-center text-sm text-muted">{max} kids is the most on one signature.</p>
        )}
        <p className="text-center text-xs text-muted">For kids under {ageOfMajority} coming with you.</p>
      </div>
    </>
  );
}
