import { roleHueClass } from "../assignment/role-hue";

/**
 * The role identity glyph (DEC-086) — an 18px hue square with the role's initial
 * (captain-blue "C" / mate-teal "M"). Decorative + `aria-hidden`: it reinforces
 * identity, it doesn't carry it — the caller renders the role name as visible text
 * beside it, which is the accessible answer. Same hue map as the cockpit seat-card
 * glyph and the board's filled pips (role-hue.ts), so all three speak one language.
 *
 * NO open state here, and none is wanted (#598). Its only caller renders
 * `card.coCrew` — people actually on the shift — so every glyph is a filled seat by
 * construction. Only the BOARD's pips grew an open treatment, because the board is a
 * scan for gaps; the cockpit seat-card glyph stayed always-filled on the operator's
 * call, since its own state badge sits beside it and the hue's job there is
 * captain-vs-mate identity. Don't add a `filled` prop to either this or the
 * seat-card glyph in the name of consistency — two of the three surfaces are
 * identity-only on purpose.
 */
export function RoleGlyph({ roleName }: { roleName: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] text-[10px] font-bold uppercase text-white ${roleHueClass(roleName)}`}
    >
      {roleName.charAt(0)}
    </span>
  );
}
