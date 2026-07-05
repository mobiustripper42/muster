/**
 * Canonical hrefs for the two cockpit hosts (DEC-085 pane mechanics).
 *
 * `ctx` is the board's filter query string (window + mode, never `sel`, never
 * feedback params) and doubles as the host signal:
 *  - `ctx === null`  → standalone host: `/admin/shift/<id>`
 *  - `ctx` a string  → board-pane host: `/admin/shifts?<ctx>&sel=<id>` ("" is a
 *    real value — the default window with no filter params)
 *
 * The path is always hard-coded and `ctx` only ever lands after the `?` — the
 * split/merge `back` posture (DEC-026): no form-supplied path, no path
 * validation to get wrong.
 */
export function cockpitHref(
  shiftId: string,
  ctx: string | null,
  params?: string,
): string {
  const extra = params ? `&${params}` : "";
  if (ctx === null) {
    const base = `/admin/shift/${encodeURIComponent(shiftId)}`;
    return params ? `${base}?${params}` : base;
  }
  const filter = ctx ? `${ctx}&` : "";
  return `/admin/shifts?${filter}sel=${encodeURIComponent(shiftId)}${extra}`;
}
