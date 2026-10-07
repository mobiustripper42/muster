import { roleHueClass } from "../assignment/role-hue";

/**
 * The glyph's shape — an 18px square, the role's initial at 10px. A MARK, not a box (issue #484,
 * part 5): it keeps its own 5px corner instead of the shared box radius, which would turn it into
 * a coin, and this file is exempt from the radius rule for that reason (`eslint.config.mjs`).
 * Exported so the board's seat pips (`components/admin/seat-pips.tsx`) draw the same square in
 * their own open and trainee states without writing the radius a second time.
 */
export const GLYPH_SHAPE = "flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-[10px] font-bold";

/**
 * The role identity glyph (DEC-086) — an 18px hue square with the role's initial
 * (captain-blue "C" / mate-teal "M"). Decorative + `aria-hidden`: it reinforces
 * identity, it doesn't carry it — the caller renders the role name as visible text
 * beside it, which is the accessible answer. Same hue map as the board's filled
 * pips (role-hue.ts), so the surfaces speak one language.
 *
 * NO open state here, and none is wanted (#598). Its callers — the crew shift page's
 * `card.coCrew` and the cockpit seat card — show people actually on the shift, or a
 * seat whose own state badge sits beside the glyph, so the hue's job is captain-vs-
 * mate identity. Only the BOARD's pips grew an open treatment, because the board is
 * a scan for gaps. Don't add a `filled` prop here in the name of consistency — two
 * of the three surfaces are identity-only on purpose.
 */
export function RoleGlyph({ roleName }: { roleName: string }) {
  return (
    <span aria-hidden="true" className={`${GLYPH_SHAPE} shrink-0 uppercase text-white ${roleHueClass(roleName)}`}>
      {roleName.charAt(0)}
    </span>
  );
}
