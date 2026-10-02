import { select } from "./form-look";

/**
 * A date of birth as three selects — month, day, year (spec §A1). The adult's details and every
 * child card use it, so it holds no client code and no directive: it renders on the server inside
 * the form, and in the browser inside the `ChildCards` island.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Month, day and year as the selects carry them: a field name each, or a value each. */
export interface DobParts {
  month: string;
  day: string;
  year: string;
}

export function DateOfBirth({
  names,
  years,
  defaults,
  label,
}: {
  /** `dobMonth`… for the adult; `childMonth`… for a child card (every card posts the same names). */
  names: DobParts;
  years: number[];
  /** What starts selected — a refused or restored form's values, else blank. */
  defaults: DobParts;
  label: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm text-muted">{label}</legend>
      <div className="grid grid-cols-[1.4fr_1fr_1.1fr] gap-2">
        <select name={names.month} required aria-label={`${label}: month`} defaultValue={defaults.month} className={select}>
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select name={names.day} required aria-label={`${label}: day`} defaultValue={defaults.day} className={select}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select name={names.year} required aria-label={`${label}: year`} defaultValue={defaults.year} className={select}>
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}
