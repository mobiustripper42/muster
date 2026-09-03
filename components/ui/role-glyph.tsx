import { roleHueClass } from "../assignment/role-hue";

/**
 * The role identity glyph (DEC-086) — an 18px hue square with the role's initial
 * (captain-blue "C" / mate-teal "M"). Decorative + `aria-hidden`: it reinforces
 * identity, it doesn't carry it — the caller renders the role name as visible text
 * beside it, which is the accessible answer. Same hue map as the cockpit seat-card
 * glyph and the board's filled pips (role-hue.ts), so all three speak one language.
 *
 * This one has NO open state, and doesn't need one (#598): its only caller renders
 * `card.coCrew` — people actually on the shift — so every glyph here is a filled
 * seat by construction. The cockpit and board versions grew an open treatment
 * because they render seats that may have nobody in them. Don't "restore
 * consistency" by adding a `filled` prop here; there is no open co-crew member.
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
