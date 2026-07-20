"use client";

import { useRef, useState } from "react";
import type { PriceVariation } from "@core/domain/entities.js";

/**
 * Ordered price-variations editor (12.8, DEC-123) — the one client island on the catalog
 * screen, earned by the ordering UX: **first match wins, top to bottom, never stacked** —
 * the row order IS the resolution rule, so the operator must be able to reorder rows, and
 * a native no-JS form can't express that. Rows live in React state and serialize to ONE
 * hidden input (`name="priceVariations"`, JSON) the server action parses — the island owns
 * interaction only; persistence stays on the server form (DEC-026 posture).
 *
 * Reorder = drag (HTML5, desktop) or the ▲/▼ buttons (keyboard + touch — 375px has no drag).
 * Rows carry a stable `key` (not the array index) so a reordered row keeps its inputs' local
 * edit state. Amounts use {@link NumericInput} (string-buffered) so the field can be empty and
 * accept a leading minus — a discount is a negative adjustment (−$50, −20%). Props are plain
 * data (no functions server→client — RSC rule).
 */

const inputClass =
  "rounded-lg border border-line bg-bg px-2 py-1.5 text-sm text-ink";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // Mon=0…Sun=6

function newRow(): PriceVariation {
  return {
    label: "",
    applies: { kind: "weekdays", weekdays: [] },
    adjustment: { kind: "flatCents", deltaCents: 0 },
  };
}

/**
 * A numeric text input that buffers what the operator types as a string, so the field can be
 * emptied (no un-removable leading 0) and can hold a lone "-" mid-entry (to type a discount).
 * Reports the parsed number to the parent; "" and "-" report 0. type=text + inputMode=decimal
 * (not type=number) is deliberate — a controlled number input fights an empty/negative value.
 */
function NumericInput({
  value,
  onValue,
  className,
  placeholder,
  ariaLabel,
}: {
  value: number;
  onValue: (n: number) => void;
  className?: string;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [text, setText] = useState(value === 0 ? "" : String(value));
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const trimmed = t.trim();
        const n = trimmed === "" || trimmed === "-" ? 0 : Number(trimmed);
        onValue(Number.isFinite(n) ? n : 0);
      }}
      className={className}
    />
  );
}

export function PriceVariationsEditor({ initial }: { initial: PriceVariation[] }) {
  const nextKey = useRef(0);
  const [rows, setRows] = useState<{ key: number; row: PriceVariation }[]>(() =>
    initial.map((row) => ({ key: nextKey.current++, row })),
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const update = (i: number, row: PriceVariation) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, row } : r)));
  const move = (i: number, to: number) => {
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [r] = next.splice(i, 1);
    next.splice(to, 0, r!);
    setRows(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* The serialized rule — what the form actually submits. */}
      <input type="hidden" name="priceVariations" value={JSON.stringify(rows.map((r) => r.row))} />

      {rows.length > 0 && (
        <p className="text-xs text-faint">
          First match wins, top to bottom — variations never stack. The order is the rule. Use a
          minus for a discount (−50 or −20%).
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {rows.map(({ key, row }, i) => (
          <li
            key={key}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== i) move(dragIndex, i);
              setDragIndex(null);
            }}
            className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-bg/50 p-2"
          >
            <span className="cursor-grab select-none font-mono text-xs text-faint" aria-hidden>
              ⠿ {i + 1}
            </span>
            <input
              aria-label={`Variation ${i + 1} label`}
              placeholder="Label (e.g. July 4th)"
              value={row.label}
              onChange={(e) => update(i, { ...row, label: e.target.value })}
              className={`${inputClass} w-36`}
            />

            {/* Applies */}
            <select
              aria-label={`Variation ${i + 1} applies`}
              value={row.applies.kind}
              onChange={(e) => {
                const kind = e.target.value as PriceVariation["applies"]["kind"];
                update(i, {
                  ...row,
                  applies:
                    kind === "weekdays"
                      ? { kind, weekdays: [] }
                      : kind === "date"
                        ? { kind, date: "" }
                        : { kind, start: "", end: "" },
                });
              }}
              className={inputClass}
            >
              <option value="weekdays">Weekdays</option>
              <option value="date">Date</option>
              <option value="dateRange">Date range</option>
            </select>
            {row.applies.kind === "weekdays" && (
              <span className="flex flex-wrap gap-1">
                {WEEKDAY_LABELS.map((label, d) => {
                  const applies = row.applies as { kind: "weekdays"; weekdays: number[] };
                  const on = applies.weekdays.includes(d);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        update(i, {
                          ...row,
                          applies: {
                            kind: "weekdays",
                            weekdays: on
                              ? applies.weekdays.filter((x) => x !== d)
                              : [...applies.weekdays, d].sort(),
                          },
                        })
                      }
                      className={`select-none rounded-full border px-2 py-0.5 text-xs ${
                        on ? "border-ink bg-ink text-white" : "border-line bg-card text-muted"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </span>
            )}
            {row.applies.kind === "date" && (
              <input
                type="date"
                aria-label={`Variation ${i + 1} date`}
                value={row.applies.date}
                onChange={(e) => update(i, { ...row, applies: { kind: "date", date: e.target.value } })}
                className={inputClass}
              />
            )}
            {row.applies.kind === "dateRange" && (
              <span className="flex items-center gap-1">
                <input
                  type="date"
                  aria-label={`Variation ${i + 1} range start`}
                  value={row.applies.start}
                  onChange={(e) =>
                    update(i, {
                      ...row,
                      applies: { ...(row.applies as { kind: "dateRange"; start: string; end: string }), start: e.target.value },
                    })
                  }
                  className={inputClass}
                />
                <span className="text-xs text-faint">to</span>
                <input
                  type="date"
                  aria-label={`Variation ${i + 1} range end`}
                  value={row.applies.end}
                  onChange={(e) =>
                    update(i, {
                      ...row,
                      applies: { ...(row.applies as { kind: "dateRange"; start: string; end: string }), end: e.target.value },
                    })
                  }
                  className={inputClass}
                />
              </span>
            )}

            {/* Adjustment — a minus makes it a discount. */}
            <select
              aria-label={`Variation ${i + 1} adjustment kind`}
              value={row.adjustment.kind}
              onChange={(e) =>
                update(i, {
                  ...row,
                  adjustment:
                    e.target.value === "flatCents"
                      ? { kind: "flatCents", deltaCents: 0 }
                      : { kind: "percent", percent: 0 },
                })
              }
              className={inputClass}
            >
              <option value="flatCents">± $</option>
              <option value="percent">± %</option>
            </select>
            {row.adjustment.kind === "flatCents" ? (
              <NumericInput
                ariaLabel={`Variation ${i + 1} dollars`}
                placeholder="± e.g. -50"
                value={row.adjustment.deltaCents / 100}
                onValue={(dollars) =>
                  update(i, { ...row, adjustment: { kind: "flatCents", deltaCents: Math.round(dollars * 100) } })
                }
                className={`${inputClass} w-24 font-mono`}
              />
            ) : (
              <NumericInput
                ariaLabel={`Variation ${i + 1} percent`}
                placeholder="± e.g. -20"
                value={row.adjustment.percent}
                onValue={(percent) => update(i, { ...row, adjustment: { kind: "percent", percent } })}
                className={`${inputClass} w-20 font-mono`}
              />
            )}

            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-label={`Move variation ${i + 1} up`}
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                className="rounded-lg border border-line px-2 py-1 text-xs text-muted disabled:opacity-40"
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move variation ${i + 1} down`}
                onClick={() => move(i, i + 1)}
                disabled={i === rows.length - 1}
                className="rounded-lg border border-line px-2 py-1 text-xs text-muted disabled:opacity-40"
              >
                ▼
              </button>
              <button
                type="button"
                aria-label={`Remove variation ${i + 1}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="rounded-lg border border-line px-2 py-1 text-xs text-muted"
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => setRows([...rows, { key: nextKey.current++, row: newRow() }])}
        className="self-start rounded-lg border border-dashed border-line bg-card px-3 py-1.5 text-sm text-accent"
      >
        + Price variation
      </button>
    </div>
  );
}
