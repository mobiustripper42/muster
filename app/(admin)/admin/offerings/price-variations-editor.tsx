"use client";

import { useState } from "react";
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
 * Props are plain data (no functions server→client — RSC rule).
 */

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // Mon=0…Sun=6

const inputClass =
  "rounded-lg border border-line bg-bg px-2 py-1.5 text-sm text-ink";

function newRow(): PriceVariation {
  return {
    label: "",
    applies: { kind: "weekdays", weekdays: [] },
    adjustment: { kind: "flatCents", deltaCents: 0 },
  };
}

export function PriceVariationsEditor({ initial }: { initial: PriceVariation[] }) {
  const [rows, setRows] = useState<PriceVariation[]>(initial);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const update = (i: number, row: PriceVariation) =>
    setRows(rows.map((r, j) => (j === i ? row : r)));
  const move = (i: number, to: number) => {
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(to, 0, row!);
    setRows(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* The serialized rule — what the form actually submits. */}
      <input type="hidden" name="priceVariations" value={JSON.stringify(rows)} />

      {rows.length > 0 && (
        <p className="text-xs text-faint">
          First match wins, top to bottom — variations never stack. The order is the rule.
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li
            key={i}
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
                      className={`rounded-full border px-2 py-0.5 text-xs ${
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

            {/* Adjustment */}
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
              <input
                type="number"
                step="0.01"
                aria-label={`Variation ${i + 1} dollars`}
                value={row.adjustment.deltaCents / 100}
                onChange={(e) =>
                  update(i, {
                    ...row,
                    adjustment: { kind: "flatCents", deltaCents: Math.round(Number(e.target.value || 0) * 100) },
                  })
                }
                className={`${inputClass} w-24 font-mono`}
              />
            ) : (
              <input
                type="number"
                step="0.1"
                aria-label={`Variation ${i + 1} percent`}
                value={row.adjustment.percent}
                onChange={(e) =>
                  update(i, {
                    ...row,
                    adjustment: { kind: "percent", percent: Number(e.target.value || 0) },
                  })
                }
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
        onClick={() => setRows([...rows, newRow()])}
        className="self-start rounded-lg border border-dashed border-line bg-card px-3 py-1.5 text-sm text-accent"
      >
        + Price variation
      </button>
    </div>
  );
}
